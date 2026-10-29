import { planAnalysisInput } from "./analyze/analysisInput.js";
import type { ChutesModelPlan } from "./analyze/chutesModelSelection.js";
import { fitAnalysisInputToContextWindow } from "./analyze/fitContextWindow.js";
import { buildChatMessages, buildChutesRequestBody, estimateRequestBudget } from "./analyze/llmPrompt.js";
import { classificationOutputTokenCeiling } from "./analyze/outputBudget.js";
import { postAliases } from "./analyze/postAliases.js";
import {
  longPreflightPosts,
  modestPreflightPosts,
} from "./analyze/preflightPostShapes.js";
import { loadDesearchMaxRequestsPerHandle, loadDesearchRequestBudget } from "./config/desearchSettings.js";
import { LLM_RUN_BUDGET_USD, chutesRequestMaxTokens } from "./config/llmSettings.js";
import { DEFAULT_QUESTION } from "./config.js";
import {
  describeDesearchCountOnWire,
  desearchWorstCaseListPriceUsd,
  sampleDesearchRequest,
} from "./runtime/desearchPreflight.js";
import {
  providerHostPreflightLines,
  providerOverrideWarningLines,
} from "./runtime/providerUrlPreflight.js";
import type { Post } from "./types.js";

function chutesEstimateForPosts(input: {
  posts: readonly Post[];
  handle: string;
  question: string;
  referenceDate: string;
  env: NodeJS.ProcessEnv;
  modelId: string;
  contextLengthTokens: number;
  pricing: { promptUsdPerMillion: number; completionUsdPerMillion: number };
}): number {
  const planned = planAnalysisInput([...input.posts], input.handle);
  const fitted = fitAnalysisInputToContextWindow(planned, {
    question: input.question,
    referenceDate: input.referenceDate,
    postSource: "desearch",
    env: input.env,
    modelId: input.modelId,
    contextLengthTokens: input.contextLengthTokens,
  });
  const aliases = postAliases(fitted.sent).map((item) => item.alias);
  const body = buildChutesRequestBody(
    buildChatMessages(input.question, fitted.sent, input.referenceDate, "desearch"),
    input.modelId,
    chutesRequestMaxTokens(classificationOutputTokenCeiling(fitted.sent.length, input.env)),
    aliases,
  );
  return estimateRequestBudget(body, input.env, input.pricing).estimatedUsd;
}

export function chutesWorstCaseEstimateUsd(input: {
  question: string;
  referenceDate: string;
  handles: readonly string[];
  postsPerHandle: readonly number[];
  env: NodeJS.ProcessEnv;
  chutesModelPlan: ChutesModelPlan;
}): number {
  const primary = input.chutesModelPlan.primary.model;
  let total = 0;
  for (let index = 0; index < input.handles.length; index += 1) {
    const count = input.postsPerHandle[index] ?? 0;
    if (count <= 0) continue;
    const handle = input.handles[index]!;
    const modestUsd = chutesEstimateForPosts({
      posts: modestPreflightPosts(count, handle),
      handle,
      question: input.question,
      referenceDate: input.referenceDate,
      env: input.env,
      modelId: primary.id,
      contextLengthTokens: primary.contextLength,
      pricing: primary.pricing,
    });
    const longUsd = chutesEstimateForPosts({
      posts: longPreflightPosts(count, handle),
      handle,
      question: input.question,
      referenceDate: input.referenceDate,
      env: input.env,
      modelId: primary.id,
      contextLengthTokens: primary.contextLength,
      pricing: primary.pricing,
    });
    total += Math.max(modestUsd, longUsd);
  }
  return total;
}

function formatFallbackLine(plan: ChutesModelPlan): string {
  if (plan.fallbacks.length === 0) return "Chutes fallbacks: (none)";
  return `Chutes fallbacks: ${plan.fallbacks.map((item) => item.model.id).join(", ")}`;
}

export function buildAnalyzePreflightLines(input: {
  handles: readonly string[];
  question: string;
  referenceDate: string;
  replay: boolean;
  offline: boolean;
  env: NodeJS.ProcessEnv;
  postsPerHandle?: readonly number[];
  chutesModelPlan?: ChutesModelPlan;
}): string[] {
  const mode = { offline: input.offline, replay: input.replay };
  const questionLine = input.question || DEFAULT_QUESTION;

  if (input.offline) {
    return [
      `Handles: ${input.handles.join(", ")}`,
      `Question: ${questionLine}`,
      `Analysis reference date: ${input.referenceDate}`,
      "DESEARCH_MAX_REQUESTS_PER_RUN: not required offline",
      "DESEARCH_MAX_REQUESTS_PER_HANDLE: not required offline",
      "Desearch: not used (offline)",
      "Chutes: not used (offline)",
    ];
  }

  const plan = input.chutesModelPlan;
  if (plan === undefined) {
    throw new Error("Chutes model plan is required for live preflight");
  }

  const sample = sampleDesearchRequest();
  const runBudget = loadDesearchRequestBudget(input.env);
  const perHandleCap = loadDesearchMaxRequestsPerHandle(input.env);
  const requestsPerHandle =
    perHandleCap === undefined ? runBudget : Math.min(perHandleCap, runBudget);
  const desearch = input.replay
    ? null
    : desearchWorstCaseListPriceUsd({
        handles: input.handles.length,
        requestsPerHandle,
        sampleRequest: sample,
      });

  const lines = [
    ...providerOverrideWarningLines(input.env, mode),
    ...providerHostPreflightLines(input.env, mode),
    `Handles: ${input.handles.join(", ")}`,
    `Question: ${questionLine}`,
    `Analysis reference date: ${input.referenceDate}`,
  ];

  if (plan.skippedCatalogEntries > 0) {
    lines.push(
      `Chutes catalog: ${plan.skippedCatalogEntries} entries skipped (unpriced or incomplete)`,
    );
  }

  const primary = plan.primary;
  lines.push(
    "Chutes: one request per handle (automatic model selection)",
    `Chutes model: ${primary.model.id} (rank ${primary.rank}, worst-case $${primary.worstCaseUsdPerHandle.toFixed(6)} per handle)`,
    formatFallbackLine(plan),
    `Chutes model prior valid report: ${plan.priorValidReport ? "yes" : "no"}`,
  );

  if (input.replay) {
    lines.push(
      "DESEARCH_MAX_REQUESTS_PER_RUN: not required for replay",
      "DESEARCH_MAX_REQUESTS_PER_HANDLE: not required for replay",
      "Desearch: not used (replay), $0.000000",
    );
  } else {
    lines.push(
      `DESEARCH_MAX_REQUESTS_PER_RUN: ${runBudget}`,
      `DESEARCH_MAX_REQUESTS_PER_HANDLE: ${perHandleCap ?? "(unset)"}`,
      describeDesearchCountOnWire(sample),
      `Desearch worst-case list-price estimate (not a charge): usage_count ${desearch!.usageCount}, list_price_usd ${desearch!.listPriceUsd.toFixed(6)} (${desearch!.basis})`,
    );
  }

  const postsPerHandle = input.replay
    ? input.postsPerHandle
    : input.handles.map(() => desearch!.postsPerRequest * requestsPerHandle);
  if (postsPerHandle === undefined) {
    throw new Error("Replay preflight requires a post count for each handle");
  }
  const chutesEstimate = chutesWorstCaseEstimateUsd({
    question: input.question,
    referenceDate: input.referenceDate,
    handles: input.handles,
    postsPerHandle,
    env: input.env,
    chutesModelPlan: plan,
  });
  const handleWord = input.handles.length === 1 ? "handle" : "handles";
  lines.push(
    `Chutes worst-case local estimate (not a charge; larger of modest and long post shapes): $${chutesEstimate.toFixed(6)} across ${input.handles.length} ${handleWord}`,
  );
  lines.push(
    `Chutes per-run worst-case local cap: $${LLM_RUN_BUDGET_USD.toFixed(2)} (planned $${chutesEstimate.toFixed(6)} across ${input.handles.length} ${handleWord})`,
  );
  return lines;
}

export function assertPrimaryRunBudgetPreflight(input: {
  question: string;
  referenceDate: string;
  handles: readonly string[];
  postsPerHandle: readonly number[];
  env: NodeJS.ProcessEnv;
  chutesModelPlan: ChutesModelPlan;
}): void {
  const total = chutesWorstCaseEstimateUsd(input);
  if (total > LLM_RUN_BUDGET_USD) {
    throw new Error(
      `Primary model worst-case estimate $${total.toFixed(6)} across ${input.handles.length} handle(s) exceeds the $${LLM_RUN_BUDGET_USD.toFixed(2)} run budget`,
    );
  }
}

export function printAnalyzePreflight(input: {
  handles: readonly string[];
  question: string;
  referenceDate: string;
  replay: boolean;
  offline: boolean;
  env: NodeJS.ProcessEnv;
  postsPerHandle?: readonly number[];
  chutesModelPlan?: ChutesModelPlan;
}): void {
  process.stdout.write(`${buildAnalyzePreflightLines(input).join("\n")}\n`);
}
