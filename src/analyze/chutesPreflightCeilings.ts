import { planAnalysisInput } from "./analysisInput.js";
import { fitAnalysisInputToContextWindow } from "./fitContextWindow.js";
import { buildChatMessages, buildChutesRequestBody, estimateRequestBudget } from "./llmPrompt.js";
import { classificationOutputJsonByteCeiling, classificationOutputTokenCeiling } from "./outputBudget.js";
import { postAliases } from "./postAliases.js";
import {
  longPreflightPosts,
  modestPreflightPosts,
} from "./preflightPostShapes.js";
import { loadInputMaxChars } from "../config/llmSettings.js";
import type { HandleTokenCeilings } from "./chutesModelEligibility.js";
import { readTokenizerJsonPath } from "./tokenizerRuntimeEnv.js";
import { loadTokenizerRuntimeFromJsonPath } from "./tokenizerRuntime.js";

function bootstrapCeilings(env: NodeJS.ProcessEnv, sentCount: number): HandleTokenCeilings {
  const inputTokensUpper = Math.ceil(loadInputMaxChars(env) / 4) + 512;
  const outputTokensUpper = classificationOutputJsonByteCeiling(sentCount);
  return { inputTokensUpper, outputTokensUpper };
}

export function worstCaseHandleCeilings(input: {
  handle: string;
  question: string;
  referenceDate: string;
  maxRetrievedPostsPerHandle: number;
  modelId: string;
  contextLengthTokens: number;
  env: NodeJS.ProcessEnv;
  tokenizerJsonPath?: string;
}): HandleTokenCeilings {
  const tokenizerPath = input.tokenizerJsonPath ?? readTokenizerJsonPath(input.env);
  if (tokenizerPath === undefined) {
    return bootstrapCeilings(input.env, input.maxRetrievedPostsPerHandle);
  }
  let inputTokensUpper = 0;
  let outputTokensUpper = 0;
  const runtime = loadTokenizerRuntimeFromJsonPath(tokenizerPath);
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
      tokenizerJsonPath: tokenizerPath,
      tokenizerRuntime: runtime,
    });
    const aliases = postAliases(fitted.sent).map((item) => item.alias);
    const outputCeiling = classificationOutputTokenCeiling(fitted.sent.length, input.env, runtime);
    const body = buildChutesRequestBody(
      buildChatMessages(input.question, fitted.sent, input.referenceDate, "desearch"),
      input.modelId,
      outputCeiling,
      aliases,
    );
    const estimate = estimateRequestBudget(body, input.env, undefined, runtime);
    inputTokensUpper = Math.max(inputTokensUpper, estimate.inputTokensUpper);
    outputTokensUpper = Math.max(outputTokensUpper, outputCeiling);
  }
  return { inputTokensUpper, outputTokensUpper };
}
