import {
  LLM_FRAMING_TOKENS_PER_MESSAGE,
  LLM_TOKENIZER_CALIBRATION_FIXED,
  LLM_TOKENIZER_CALIBRATION_RATIO,
  priceTokenCeiling,
  type ChutesModelPricing,
} from "../config/llmSettings.js";
import type { BudgetEstimate } from "../types.js";
import type { ChutesRequestBody } from "./llmPrompt.js";
import { encodeMessagesContent, getRunTokenizerRuntime } from "./tokenizerRuntimeEnv.js";
import {
  setTokenizerRuntimeForTests as setTestTokenizerRuntime,
  type TokenizerRuntime,
} from "./tokenizerRuntime.js";

export function setTokenizerRuntimeForTests(runtime: TokenizerRuntime | null): void {
  setTestTokenizerRuntime(runtime);
}

export interface InputTokenBreakdown {
  messageTokens: number;
  responseFormatTokens: number;
  calibrationMarginTokens: number;
  inputTokensUpper: number;
}

export function calibrationMarginTokens(messageTokens: number): number {
  const scaled = Math.ceil(messageTokens * LLM_TOKENIZER_CALIBRATION_RATIO);
  return Math.max(LLM_TOKENIZER_CALIBRATION_FIXED, scaled);
}

function resolveRuntime(env: NodeJS.ProcessEnv, runtimeOverride?: TokenizerRuntime): TokenizerRuntime {
  if (runtimeOverride !== undefined) return runtimeOverride;
  return getRunTokenizerRuntime(env);
}

export function countRequestInputTokens(
  body: ChutesRequestBody,
  env: NodeJS.ProcessEnv,
  runtimeOverride?: TokenizerRuntime,
): InputTokenBreakdown {
  const runtime = resolveRuntime(env, runtimeOverride);
  const messageTokens =
    encodeMessagesContent(runtime, body.messages) +
    body.messages.length * LLM_FRAMING_TOKENS_PER_MESSAGE;
  const responseFormatText = JSON.stringify(body.response_format);
  const responseFormatTokens = runtime.encode(responseFormatText).length;
  const calibrationMarginTokensValue = calibrationMarginTokens(messageTokens);
  const inputTokensUpper =
    messageTokens + responseFormatTokens + calibrationMarginTokensValue;
  return {
    messageTokens,
    responseFormatTokens,
    calibrationMarginTokens: calibrationMarginTokensValue,
    inputTokensUpper,
  };
}

export function estimateRequestBudgetFromTokenizer(
  body: ChutesRequestBody,
  env: NodeJS.ProcessEnv,
  pricing: ChutesModelPricing | undefined,
  runtimeOverride?: TokenizerRuntime,
): BudgetEstimate {
  const input = countRequestInputTokens(body, env, runtimeOverride);
  const priced = priceTokenCeiling(input.inputTokensUpper, body.max_tokens, pricing);
  return {
    ...priced,
    basis: "hf-tokenizer-conservative",
    messageTokens: input.messageTokens,
    responseFormatTokens: input.responseFormatTokens,
    calibrationMarginTokens: input.calibrationMarginTokens,
  };
}
