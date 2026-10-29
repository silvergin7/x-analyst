import { pathToFileURL } from "node:url";
import { planAnalysisInput } from "./analyze/analysisInput.js";
import { LlmOutlookAnalyzer } from "./analyze/llmOutlookAnalyzer.js";
import { LlmCallError, LlmCitationError, LlmOutputError } from "./analyze/llmOutlookAnalyzer.js";
import {
  createFetchChutesTransport,
  type ChutesTransport,
} from "./analyze/chutesClient.js";
import { buildChatMessages, buildChutesRequestBody, estimateRequestBudget } from "./analyze/llmPrompt.js";
import { postAliases } from "./analyze/postAliases.js";
import { classificationOutputTokenCeiling } from "./analyze/outputBudget.js";
import { loadFetchLimits, DEFAULT_QUESTION } from "./config.js";
import {
  LLM_CALL_BUDGET_USD,
  chutesRequestMaxTokens,
  LLM_MAX_QUESTION_CHARS,
  loadLlmRuntimeConfig,
  parseAnalysisReferenceDate,
  utcReferenceDate,
} from "./config/llmSettings.js";
import { MockPostsFetcher } from "./fetch/postsFetcher.js";
import {
  formatBudgetEstimate,
  formatLlmFixtureReport,
  formatProviderUsage,
} from "./format/llmFixtureReport.js";
import type { ProviderTokenUsage } from "./types.js";
import { formatFetchIssue } from "./format/report.js";

export interface FixtureCheckInput {
  handle: string;
  question: string;
  env: NodeJS.ProcessEnv;
  transport: ChutesTransport;
  write: (text: string) => void;
  /** UTC YYYY-MM-DD. When omitted, the command uses today's UTC date. */
  referenceDate?: string;
}

export interface ParsedFixtureArgs {
  handle?: string;
  question: string;
  referenceDate?: string;
  errors: string[];
}

function nextIsValue(argv: string[], index: number): boolean {
  const next = argv[index + 1];
  return next !== undefined && !next.startsWith("--");
}

/** `analyze:llm-fixture <handle> [--question text] [--as-of YYYY-MM-DD]` */
export function parseFixtureArgs(argv: string[]): ParsedFixtureArgs {
  const errors: string[] = [];
  let question = DEFAULT_QUESTION;
  let referenceDate: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--question") {
      if (!nextIsValue(argv, i)) {
        errors.push("Missing value for --question");
      } else {
        question = argv[++i]!;
      }
      continue;
    }
    if (arg === "--as-of") {
      if (!nextIsValue(argv, i)) {
        errors.push("Missing value for --as-of");
      } else {
        referenceDate = argv[++i]!;
      }
      continue;
    }
    if (arg.startsWith("--")) {
      errors.push(`Unknown argument ${arg}`);
      continue;
    }
    positionals.push(arg);
  }

  if (positionals.length !== 1) {
    errors.push("Provide exactly one fixture handle");
  }

  return { handle: positionals[0], question, referenceDate, errors };
}

function failureMessage(err: unknown): string {
  if (
    err instanceof LlmCallError ||
    err instanceof LlmOutputError ||
    err instanceof LlmCitationError
  ) {
    return err.message;
  }
  return "Analysis failed.";
}

function failureUsage(err: unknown): ProviderTokenUsage | null {
  if (
    err instanceof LlmCallError ||
    err instanceof LlmOutputError ||
    err instanceof LlmCitationError
  ) {
    return err.providerUsage;
  }
  return null;
}

/**
 * Opt-in fixture check. Reads one handle from the mock fetcher.
 * Calls Chutes only when the live gates and local budget both pass.
 */
export async function runLlmFixtureCheck(input: FixtureCheckInput): Promise<number> {
  const config = loadLlmRuntimeConfig(input.env);
  if (!config.eligible) {
    input.write(`${config.reason ?? "Chutes live call is not enabled"}\n`);
    return 1;
  }
  if (input.question.trim() === "" || input.question.length > LLM_MAX_QUESTION_CHARS) {
    input.write(
      `Question must be 1 to ${LLM_MAX_QUESTION_CHARS} characters. No request was sent.\n`,
    );
    return 1;
  }
  const referenceDate = parseAnalysisReferenceDate(
    input.referenceDate ?? utcReferenceDate(),
  );
  if (!referenceDate) {
    input.write("Analysis reference date must be YYYY-MM-DD. No request was sent.\n");
    return 1;
  }
  input.write(
    `Synthetic fixture test. Analysis reference date: ${referenceDate}. These posts are not current real-world research.\n`,
  );

  const fetcher = new MockPostsFetcher();
  const [outcome] = await fetcher.fetchForHandles([input.handle], loadFetchLimits());
  if (!outcome || outcome.status !== "ok") {
    input.write(`${outcome ? formatFetchIssue(outcome) : "No fetch outcome"}\n`);
    return 1;
  }

  const plan = planAnalysisInput(outcome.posts, outcome.handle);
  if (plan.sent.length > 0) {
    const estimate = estimateRequestBudget(
      buildChutesRequestBody(
        buildChatMessages(input.question, plan.sent, referenceDate),
        config.model,
        chutesRequestMaxTokens(classificationOutputTokenCeiling(plan.sent.length, input.env)),
        postAliases(plan.sent).map((item) => item.alias),
      ),
      input.env,
      config.modelPricing,
    );
    input.write(`${formatBudgetEstimate(estimate)}\n`);
    if (estimate.estimatedUsd > LLM_CALL_BUDGET_USD) {
      input.write("No request was sent.\n");
      return 1;
    }
  }

  const analyzer = new LlmOutlookAnalyzer(
    config,
    input.transport,
    referenceDate,
    "desearch",
    { runEnv: input.env },
  );
  try {
    const report = await analyzer.analyzePerson(
      outcome.handle,
      outcome.posts,
      { text: input.question },
      {
        retrievalComplete: outcome.retrievalComplete,
        incompleteReason: outcome.incompleteReason,
      },
    );
    input.write(`${formatLlmFixtureReport(report)}\n`);
    return 0;
  } catch (err) {
    if (err instanceof LlmCallError && err.estimate) {
      input.write(
        `Pessimistic estimate $${err.estimate.estimatedUsd.toFixed(6)} exceeds the local budget. No request was sent.\n`,
      );
    }
    input.write(`${failureMessage(err)}\n`);
    const usage = failureUsage(err);
    if (usage) {
      input.write(`${formatProviderUsage(usage)}\n`);
    }
    return 1;
  }
}

async function main(): Promise<void> {
  const parsed = parseFixtureArgs(process.argv.slice(2));
  if (parsed.errors.length > 0 || !parsed.handle) {
    for (const error of parsed.errors) {
      process.stderr.write(`${error}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.exitCode = await runLlmFixtureCheck({
    handle: parsed.handle,
    question: parsed.question,
    referenceDate: parsed.referenceDate,
    env: process.env,
    transport: createFetchChutesTransport(),
    write: (text) => process.stdout.write(text),
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void main();
}
