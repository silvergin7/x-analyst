import type { ChutesCatalogModel } from "./chutesModelCatalog.js";
import type { ChutesModelCandidate, ChutesModelPlan } from "./chutesModelSelection.js";
import {
  LlmCallError,
  requestChutesCompletion,
  type ChutesCompletion,
  type ChutesTransport,
} from "./chutesClient.js";
import type { ChatMessage } from "./llmPrompt.js";
import type { LlmRunSpendLedger } from "./llmRunSpendLedger.js";
import type { BudgetEstimate, ChutesModelAttempt, TokenizerPin } from "../types.js";
import type { LlmRuntimeConfig } from "../config/llmSettings.js";
import type { TokenizerRuntime } from "./tokenizerRuntime.js";

const FALLBACK_HTTP_STATUSES = new Set([404, 503]);

export interface PreparedChutesAttempt {
  config: LlmRuntimeConfig;
  messages: ChatMessage[];
  maxTokens: number;
  aliases: readonly string[];
  tokenizerPin?: TokenizerPin;
  tokenizerJsonPath?: string;
  tokenizerRuntime?: TokenizerRuntime;
}

export interface ChutesFallbackCompletion {
  completion: ChutesCompletion;
  modelId: string;
  modelsTried: string[];
  modelAttempts: ChutesModelAttempt[];
  tokenizerPin?: TokenizerPin;
  tokenizerJsonPath?: string;
}

function isFallbackHttpError(err: unknown): err is LlmCallError {
  return (
    err instanceof LlmCallError &&
    err.code === "http" &&
    err.httpStatus !== undefined &&
    FALLBACK_HTTP_STATUSES.has(err.httpStatus)
  );
}

export function fallbackCandidates(
  plan: ChutesModelPlan,
  excludedModelIds: ReadonlySet<string>,
): ChutesModelCandidate[] {
  return plan.candidates.filter((item) => !excludedModelIds.has(item.model.id));
}

function attachAttempts(err: LlmCallError, attempts: readonly ChutesModelAttempt[]): never {
  err.llmModelAttempts = [...attempts];
  throw err;
}

export async function requestChutesCompletionWithFallbacks(input: {
  primaryConfig: LlmRuntimeConfig;
  plan: ChutesModelPlan;
  initialAttempt: PreparedChutesAttempt;
  prepareFallback: (model: ChutesCatalogModel) => Promise<PreparedChutesAttempt | null>;
  refreshPlan?: (excludeModelIds: readonly string[]) => Promise<ChutesModelPlan>;
  transport: ChutesTransport;
  env: NodeJS.ProcessEnv;
  onEstimate?: (estimate: BudgetEstimate) => void;
  runLedger?: LlmRunSpendLedger;
  timeoutMs?: number;
}): Promise<ChutesFallbackCompletion> {
  const modelsTried: string[] = [];
  const modelsSkipped: string[] = [];
  const modelAttempts: ChutesModelAttempt[] = [];
  let tokenizerPin = input.initialAttempt.tokenizerPin;
  let plan = input.plan;

  const excludedIds = (): string[] => [...modelsTried, ...modelsSkipped];

  const excludedSet = (): ReadonlySet<string> => new Set(excludedIds());

  const recordSent = (modelId: string): void => {
    modelsTried.push(modelId);
    modelAttempts.push({ modelId, kind: "sent" });
  };

  const recordSkipped = (modelId: string): void => {
    if (modelsSkipped.includes(modelId)) return;
    modelsSkipped.push(modelId);
    modelAttempts.push({ modelId, kind: "skipped" });
  };

  function stampDuration(durationMs: number | undefined): void {
    if (durationMs === undefined) return;
    const last = modelAttempts[modelAttempts.length - 1];
    if (last !== undefined && last.kind === "sent") last.durationMs = durationMs;
  }

  async function sendAttempt(attempt: PreparedChutesAttempt): Promise<ChutesCompletion> {
    recordSent(attempt.config.model);
    try {
      const completion = await requestChutesCompletion(
        attempt.config,
        attempt.messages,
        input.transport,
        input.env,
        attempt.maxTokens,
        attempt.aliases,
        input.onEstimate,
        input.runLedger,
        attempt.tokenizerRuntime,
        input.timeoutMs,
      );
      stampDuration(completion.durationMs);
      return completion;
    } catch (err) {
      if (err instanceof LlmCallError) stampDuration(err.durationMs);
      throw err;
    }
  }

  async function refreshAfterHttp404(refreshedForResponse: { done: boolean }): Promise<void> {
    if (input.refreshPlan === undefined || refreshedForResponse.done) return;
    plan = await input.refreshPlan(excludedIds());
    refreshedForResponse.done = true;
  }

  async function tryFallbacks(originalError: LlmCallError): Promise<ChutesFallbackCompletion> {
    let fallback404Responses = 0;

    while (fallback404Responses < 2) {
      const candidates = fallbackCandidates(plan, excludedSet());
      if (candidates.length === 0) break;

      let sentPostThisRound = false;
      for (const candidate of candidates) {
        const prepared = await input.prepareFallback(candidate.model);
        if (prepared === null) {
          recordSkipped(candidate.model.id);
          continue;
        }
        sentPostThisRound = true;
        const refreshedForResponse = { done: false };
        try {
          const completion = await sendAttempt(prepared);
          return {
            completion,
            modelId: prepared.config.model,
            modelsTried,
            modelAttempts,
            tokenizerPin: prepared.tokenizerPin ?? tokenizerPin,
            tokenizerJsonPath: prepared.tokenizerJsonPath,
          };
        } catch (err) {
          if (!isFallbackHttpError(err)) {
            if (err instanceof LlmCallError) {
              attachAttempts(err, modelAttempts);
            }
            throw err;
          }
          await refreshAfterHttp404(refreshedForResponse);
          fallback404Responses += 1;
          break;
        }
      }
      if (!sentPostThisRound) break;
    }

    attachAttempts(originalError, modelAttempts);
  }

  try {
    const completion = await sendAttempt({
      ...input.initialAttempt,
      config: input.primaryConfig,
    });
    return {
      completion,
      modelId: input.primaryConfig.model,
      modelsTried,
      modelAttempts,
      tokenizerPin,
      tokenizerJsonPath: input.initialAttempt.tokenizerJsonPath,
    };
  } catch (err) {
    if (!isFallbackHttpError(err)) {
      if (err instanceof LlmCallError) {
        attachAttempts(err, modelAttempts);
      }
      throw err;
    }
    const originalError = err;
    const refreshedForPrimary = { done: false };
    await refreshAfterHttp404(refreshedForPrimary);
    return tryFallbacks(originalError);
  }
}
