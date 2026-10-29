import { fitsModelContextWindow, loadLlmRuntimeConfig } from "../config/llmSettings.js";
import type { PostSource } from "../types.js";
import {
  BEYOND_CONTEXT_WINDOW_REASON,
  comparePostTime,
  type AnalysisInputPlan,
  type SentPost,
} from "./analysisInput.js";
import { classificationOutputTokenCeiling } from "./outputBudget.js";
import type { TokenizerRuntime } from "./tokenizerRuntime.js";
import { loadTokenizerRuntimeFromJsonPath } from "./tokenizerRuntime.js";
import { postAliases } from "./postAliases.js";
import { countRequestInputTokens } from "./tokenBudget.js";
import { buildChatMessages, buildChutesRequestBody } from "./llmPrompt.js";

export interface ContextWindowFitInput {
  question: string;
  referenceDate: string;
  postSource: PostSource;
  env: NodeJS.ProcessEnv;
  modelId?: string;
  contextLengthTokens?: number;
  tokenizerJsonPath?: string;
  tokenizerRuntime?: TokenizerRuntime;
}

function resolveModelContext(input: ContextWindowFitInput): {
  modelId: string;
  contextLengthTokens: number;
} {
  if (input.modelId !== undefined && input.contextLengthTokens !== undefined) {
    return { modelId: input.modelId, contextLengthTokens: input.contextLengthTokens };
  }
  const llm = loadLlmRuntimeConfig(input.env);
  return { modelId: llm.model, contextLengthTokens: llm.contextLengthTokens };
}

function resolveTokenizerRuntime(input: ContextWindowFitInput): TokenizerRuntime | undefined {
  if (input.tokenizerRuntime !== undefined) return input.tokenizerRuntime;
  if (input.tokenizerJsonPath !== undefined) {
    return loadTokenizerRuntimeFromJsonPath(input.tokenizerJsonPath);
  }
  return undefined;
}

function estimateFits(sent: readonly SentPost[], input: ContextWindowFitInput): boolean {
  const { modelId, contextLengthTokens } = resolveModelContext(input);
  const runtime = resolveTokenizerRuntime(input);
  const aliases = postAliases(sent).map((item) => item.alias);
  const maxTokens = classificationOutputTokenCeiling(sent.length, input.env, runtime);
  const body = buildChutesRequestBody(
    buildChatMessages(input.question, [...sent], input.referenceDate, input.postSource),
    modelId,
    maxTokens,
    aliases,
  );
  const counted = countRequestInputTokens(body, input.env, runtime);
  return fitsModelContextWindow(contextLengthTokens, counted.inputTokensUpper, maxTokens);
}

/**
 * Drop the oldest eligible posts until the input ceiling plus max_tokens
 * fits the context window. Both ceilings are recalculated after each drop.
 * Dropped posts are listed as excluded with reason beyond_context_window.
 */
export function fitAnalysisInputToContextWindow(
  plan: AnalysisInputPlan,
  input: ContextWindowFitInput,
): AnalysisInputPlan {
  const sent = [...plan.sent];
  const dropped = new Set<string>();
  while (sent.length > 0 && !estimateFits(sent, input)) {
    const oldest = sent.reduce((left, right) =>
      comparePostTime(left.post, right.post) <= 0 ? left : right,
    );
    dropped.add(oldest.post.id);
    sent.splice(sent.indexOf(oldest), 1);
  }
  if (dropped.size === 0) return plan;
  return {
    sent,
    records: plan.records.map((record) => {
      if (!dropped.has(record.postId)) return record;
      return {
        postId: record.postId,
        timestamp: record.timestamp,
        disposition: "excluded",
        reason: BEYOND_CONTEXT_WINDOW_REASON,
        originalChars: record.originalChars,
        sentChars: 0,
      };
    }),
  };
}
