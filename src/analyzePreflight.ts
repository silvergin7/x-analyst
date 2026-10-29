import { planAnalysisInput } from "./analyze/analysisInput.js";
import { fitAnalysisInputToContextWindow } from "./analyze/fitContextWindow.js";
import { buildChatMessages, buildChutesRequestBody, estimateRequestBudget } from "./analyze/llmPrompt.js";
import { classificationOutputTokenCeiling } from "./analyze/outputBudget.js";
import { postAliases } from "./analyze/postAliases.js";
import {
  longPreflightPosts,
  modestPreflightPosts,
} from "./analyze/preflightPostShapes.js";
import { loadDesearchMaxRequestsPerHandle, loadDesearchRequestBudget } from "./config/desearchSettings.js";
import { PRICED_LLM_MODEL } from "./config/llmSettings.js";
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
}): number {
  const planned = planAnalysisInput([...input.posts], input.handle);
  const fitted = fitAnalysisInputToContextWindow(planned, {
    question: input.question,
    referenceDate: input.referenceDate,
    postSource: "desearch",
    env: input.env,
  });
  const aliases = postAliases(fitted.sent).map((item) => item.alias);
  const body = buildChutesRequestBody(
    buildChatMessages(input.question, fitted.sent, input.referenceDate, "desearch"),
    PRICED_LLM_MODEL,
    classificationOutputTokenCeiling(fitted.sent.length, input.env),
    aliases,
  );
  return estimateRequestBudget(body, input.env).estimatedUsd;
}

export function chutesWorstCaseEstimateUsd(input: {
  question: string;
  referenceDate: string;
  handles: readonly string[];
  maxRetrievedPostsPerHandle: number;
  env: NodeJS.ProcessEnv;
}): number {
  let total = 0;
  for (const handle of input.handles) {
    const modestUsd = chutesEstimateForPosts({
      posts: modestPreflightPosts(input.maxRetrievedPostsPerHandle, handle),
      handle,
      question: input.question,
      referenceDate: input.referenceDate,
      env: input.env,
    });
    const longUsd = chutesEstimateForPosts({
      posts: longPreflightPosts(input.maxRetrievedPostsPerHandle, handle),
      handle,
      question: input.question,
      referenceDate: input.referenceDate,
      env: input.env,
    });
    total += Math.max(modestUsd, longUsd);
  }
  return total;
}

export function buildAnalyzePreflightLines(input: {
  handles: readonly string[];
  question: string;
  referenceDate: string;
  model: string;
  replay: boolean;
  offline: boolean;
  env: NodeJS.ProcessEnv;
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

  if (input.replay) {
    lines.push(
      "DESEARCH_MAX_REQUESTS_PER_RUN: not required for replay",
      "DESEARCH_MAX_REQUESTS_PER_HANDLE: not required for replay",
      `Chutes: one request per handle; model ${input.model}`,
      "Desearch: not used (replay), $0.000000",
    );
  } else {
    lines.push(
      `DESEARCH_MAX_REQUESTS_PER_RUN: ${runBudget}`,
      `DESEARCH_MAX_REQUESTS_PER_HANDLE: ${perHandleCap ?? "(unset)"}`,
      `Chutes: one request per handle; model ${input.model}`,
      describeDesearchCountOnWire(sample),
      `Desearch worst-case list-price estimate (not a charge): usage_count ${desearch!.usageCount}, list_price_usd ${desearch!.listPriceUsd.toFixed(6)} (${desearch!.basis})`,
    );
  }

  const chutesEstimate = chutesWorstCaseEstimateUsd({
    question: input.question,
    referenceDate: input.referenceDate,
    handles: input.handles,
    maxRetrievedPostsPerHandle: desearch
      ? desearch.postsPerRequest * requestsPerHandle
      : 55,
    env: input.env,
  });
  lines.push(
    `Chutes worst-case local estimate (not a charge; larger of modest and long post shapes): $${chutesEstimate.toFixed(6)} summed across handles`,
  );
  return lines;
}

export function printAnalyzePreflight(input: {
  handles: readonly string[];
  question: string;
  referenceDate: string;
  model: string;
  replay: boolean;
  offline: boolean;
  env: NodeJS.ProcessEnv;
}): void {
  process.stdout.write(`${buildAnalyzePreflightLines(input).join("\n")}\n`);
}
