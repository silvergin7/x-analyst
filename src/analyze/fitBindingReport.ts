import {
  BEYOND_CONTEXT_WINDOW_REASON,
  BEYOND_INPUT_BUDGET_REASON,
  planAnalysisInput,
  type AnalysisInputPlan,
} from "./analysisInput.js";
import { fitAnalysisInputToContextWindow } from "./fitContextWindow.js";
import { buildChatMessages, buildChutesRequestBody } from "./llmPrompt.js";
import {
  classificationOutputJsonByteCeiling,
  classificationOutputTokenCeiling,
  emptyThinkingBlockTokenCeiling,
} from "./outputBudget.js";
import { postAliases } from "./postAliases.js";
import { countRequestInputTokens } from "./tokenBudget.js";
import { fitsModelContextWindow, loadLlmRuntimeConfig } from "../config/llmSettings.js";
import type { Post } from "../types.js";

export type FitBindingLimit =
  | "LLM_INPUT_MAX_CHARS"
  | "context_window_input"
  | "output_ceiling"
  | "none";

export interface FitShapeReport {
  postCount: number;
  postsSent: number;
  messageTokens: number;
  responseFormatTokens: number;
  calibrationMarginTokens: number;
  inputTokensUpper: number;
  outputJsonByteCeiling: number;
  emptyThinkingTokens: number;
  outputTokenCeiling: number;
  bindingLimit: FitBindingLimit;
}

function bindingForPlan(
  planned: AnalysisInputPlan,
  fitted: AnalysisInputPlan,
  inputTokensUpper: number,
  outputCeiling: number,
  contextLengthTokens: number,
): FitBindingLimit {
  const charExcluded = planned.records.some(
    (record) => record.reason === BEYOND_INPUT_BUDGET_REASON,
  );
  if (charExcluded) return "LLM_INPUT_MAX_CHARS";
  const contextExcluded = fitted.records.some(
    (record) => record.reason === BEYOND_CONTEXT_WINDOW_REASON,
  );
  if (contextExcluded) return "context_window_input";
  const allPostsSent =
    !charExcluded &&
    !contextExcluded &&
    planned.records.length > 0 &&
    planned.records.length === fitted.sent.length;
  if (
    allPostsSent &&
    fitsModelContextWindow(contextLengthTokens, inputTokensUpper, outputCeiling)
  ) {
    return "none";
  }
  if (!fitsModelContextWindow(contextLengthTokens, inputTokensUpper, outputCeiling)) {
    return outputCeiling >= inputTokensUpper ? "output_ceiling" : "context_window_input";
  }
  return outputCeiling >= inputTokensUpper ? "output_ceiling" : "context_window_input";
}

export function reportFitShape(input: {
  posts: readonly Post[];
  handle: string;
  question: string;
  referenceDate: string;
  env: NodeJS.ProcessEnv;
}): FitShapeReport {
  const planned = planAnalysisInput([...input.posts], input.handle);
  const fitted = fitAnalysisInputToContextWindow(planned, {
    question: input.question,
    referenceDate: input.referenceDate,
    postSource: "desearch",
    env: input.env,
  });
  const llm = loadLlmRuntimeConfig(input.env);
  const aliases = postAliases(fitted.sent).map((item) => item.alias);
  const maxTokens = classificationOutputTokenCeiling(fitted.sent.length, input.env);
  const body = buildChutesRequestBody(
    buildChatMessages(input.question, fitted.sent, input.referenceDate, "desearch"),
    llm.model,
    maxTokens,
    aliases,
  );
  const tokens = countRequestInputTokens(body, input.env);
  const outputJsonByteCeiling = classificationOutputJsonByteCeiling(fitted.sent.length);
  const emptyThinkingTokens = emptyThinkingBlockTokenCeiling(input.env);
  const outputTokenCeiling = outputJsonByteCeiling + emptyThinkingTokens;
  const bindingLimit = bindingForPlan(
    planned,
    fitted,
    tokens.inputTokensUpper,
    outputTokenCeiling,
    llm.contextLengthTokens,
  );
  return {
    postCount: input.posts.length,
    postsSent: fitted.sent.length,
    messageTokens: tokens.messageTokens,
    responseFormatTokens: tokens.responseFormatTokens,
    calibrationMarginTokens: tokens.calibrationMarginTokens,
    inputTokensUpper: tokens.inputTokensUpper,
    outputJsonByteCeiling,
    emptyThinkingTokens,
    outputTokenCeiling,
    bindingLimit,
  };
}
