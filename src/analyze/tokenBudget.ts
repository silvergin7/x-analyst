import {
  LLM_TOKENIZER_CALIBRATION_FIXED,
  LLM_TOKENIZER_CALIBRATION_RATIO,
  priceTokenCeiling,
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
  env: NodeJS.ProcessEnv = process.env,
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

export function estimateRequestBudgetFromTokenizer(
  body: ChutesRequestBody,
  env: NodeJS.ProcessEnv = process.env,
): BudgetEstimate {
  const input = countRequestInputTokens(body, env);
  const priced = priceTokenCeiling(input.inputTokensUpper, body.max_tokens);
  return {
    ...priced,
    basis: "qwen3-tokenizer-conservative",
    messageTokens: input.messageTokens,
    responseFormatTokens: input.responseFormatTokens,
    calibrationMarginTokens: input.calibrationMarginTokens,
  };
}
