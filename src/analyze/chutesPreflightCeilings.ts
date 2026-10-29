import { planAnalysisInput } from "./analysisInput.js";
import { fitAnalysisInputToContextWindow } from "./fitContextWindow.js";
import { buildChatMessages, buildChutesRequestBody, estimateRequestBudget } from "./llmPrompt.js";
import { classificationOutputJsonByteCeiling } from "./outputBudget.js";
import { postAliases } from "./postAliases.js";
import {
  longPreflightPosts,
  modestPreflightPosts,
} from "./preflightPostShapes.js";
import type { HandleTokenCeilings } from "./chutesModelEligibility.js";

export function worstCaseHandleCeilings(input: {
  handle: string;
  question: string;
  referenceDate: string;
  maxRetrievedPostsPerHandle: number;
  modelId: string;
  contextLengthTokens: number;
  env: NodeJS.ProcessEnv;
}): HandleTokenCeilings {
  let inputTokensUpper = 0;
  let outputTokensUpper = 0;
  for (const posts of [
    modestPreflightPosts(input.maxRetrievedPostsPerHandle, input.handle),
    longPreflightPosts(input.maxRetrievedPostsPerHandle, input.handle),
  ]) {
    const planned = planAnalysisInput([...posts], input.handle);
    const fitted = fitAnalysisInputToContextWindow(planned, {
      question: input.question,
      referenceDate: input.referenceDate,
      postSource: "desearch",
      env: input.env,
      modelId: input.modelId,
      contextLengthTokens: input.contextLengthTokens,
    });
    const aliases = postAliases(fitted.sent).map((item) => item.alias);
    const outputCeiling = classificationOutputJsonByteCeiling(fitted.sent.length);
    const body = buildChutesRequestBody(
      buildChatMessages(input.question, fitted.sent, input.referenceDate, "desearch"),
      input.modelId,
      outputCeiling,
      aliases,
    );
    const estimate = estimateRequestBudget(body, input.env, undefined);
    inputTokensUpper = Math.max(inputTokensUpper, estimate.inputTokensUpper);
    outputTokensUpper = Math.max(outputTokensUpper, outputCeiling);
  }
  return { inputTokensUpper, outputTokensUpper };
}
