import {
  LLM_TOKENIZER_CALIBRATION_FIXED,
  LLM_TOKENIZER_CALIBRATION_RATIO,
  loadLlmRuntimeConfig,
  priceTokenCeiling,
  type ChutesModelPricing,
} from "../config/llmSettings.js";
import type { BudgetEstimate } from "../types.js";
import { getQwenTokenizerRuntime } from "./qwenTokenizerRuntime.js";
import type { ChutesRequestBody } from "./llmPrompt.js";

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

export function countRequestInputTokens(
  body: ChutesRequestBody,
  env: NodeJS.ProcessEnv,
): InputTokenBreakdown {
  const runtime = getQwenTokenizerRuntime(env);
  const rendered = runtime.renderChat(body.messages);
  const messageTokens = runtime.encode(rendered).length;
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

function resolvePricing(
  env: NodeJS.ProcessEnv,
  pricingOverride: ChutesModelPricing | undefined,
): ChutesModelPricing {
  if (pricingOverride !== undefined) return pricingOverride;
  return loadLlmRuntimeConfig(env).modelPricing;
}

export function estimateRequestBudgetFromTokenizer(
  body: ChutesRequestBody,
  env: NodeJS.ProcessEnv,
  pricingOverride?: ChutesModelPricing,
): BudgetEstimate {
  const input = countRequestInputTokens(body, env);
  const priced = priceTokenCeiling(
    input.inputTokensUpper,
    body.max_tokens,
    resolvePricing(env, pricingOverride),
  );
  return {
    ...priced,
    basis: "qwen3-tokenizer-conservative",
    messageTokens: input.messageTokens,
    responseFormatTokens: input.responseFormatTokens,
    calibrationMarginTokens: input.calibrationMarginTokens,
  };
}
