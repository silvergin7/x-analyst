import {
  ChutesCatalogError,
  fetchChutesModelCatalog,
  type ChutesCatalogModel,
} from "./chutesModelCatalog.js";
import type { ChutesCatalogTransport } from "./chutesCatalogTransport.js";
import { chutesModelsListUrl } from "./chutesModelCatalog.js";
import { worstCaseHandleCeilings } from "./chutesPreflightCeilings.js";
import {
  buildChutesModelPlan,
  ChutesModelSelectionError,
  type ChutesModelPlan,
} from "./chutesModelSelection.js";
import { catalogEntryEligible, worstCaseCostUsd } from "./chutesModelEligibility.js";
import { LLM_CALL_BUDGET_USD } from "../config/llmSettings.js";
import type { HuggingFaceModelInfoTransport } from "./huggingfaceModelInfo.js";
import {
  createFetchHfDownloadTransport,
  loadTokenizerCache,
  type HuggingFaceDownloadTransport,
} from "./huggingfaceTokenizerDownload.js";
import { applyTokenizerPinToEnv } from "./tokenizerRuntimeEnv.js";
import { loadDesearchMaxRequestsPerHandle, loadDesearchRequestBudget } from "../config/desearchSettings.js";
import { sampleDesearchRequest } from "../runtime/desearchPreflight.js";

export class ChutesPreflightPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChutesPreflightPlanError";
  }
}

function maxPostsPerHandle(env: NodeJS.ProcessEnv, replay: boolean): number {
  if (replay) return 55;
  const runBudget = loadDesearchRequestBudget(env);
  const perHandleCap = loadDesearchMaxRequestsPerHandle(env);
  const requestsPerHandle =
    perHandleCap === undefined ? runBudget : Math.min(perHandleCap, runBudget);
  return 20 * requestsPerHandle;
}

function referenceContextLength(models: readonly ChutesCatalogModel[]): number {
  let max = 0;
  for (const model of models) {
    if (model.contextLength > max) max = model.contextLength;
  }
  return max > 0 ? max : 131_072;
}

function computeCeilings(input: {
  handles: readonly string[];
  question: string;
  referenceDate: string;
  maxRetrievedPostsPerHandle: number;
  modelId: string;
  contextLengthTokens: number;
  env: NodeJS.ProcessEnv;
  tokenizerJsonPath?: string;
}) {
  return input.handles.reduce(
    (acc, handle) => {
      const next = worstCaseHandleCeilings({
        handle,
        question: input.question,
        referenceDate: input.referenceDate,
        maxRetrievedPostsPerHandle: input.maxRetrievedPostsPerHandle,
        modelId: input.modelId,
        contextLengthTokens: input.contextLengthTokens,
        env: input.env,
        tokenizerJsonPath: input.tokenizerJsonPath,
      });
      return {
        inputTokensUpper: Math.max(acc.inputTokensUpper, next.inputTokensUpper),
        outputTokensUpper: Math.max(acc.outputTokensUpper, next.outputTokensUpper),
      };
    },
    { inputTokensUpper: 0, outputTokensUpper: 0 },
  );
}

export async function buildChutesModelPlanForRun(input: {
  env: NodeJS.ProcessEnv;
  handles: readonly string[];
  question: string;
  referenceDate: string;
  replay: boolean;
  catalogTransport: ChutesCatalogTransport;
  hfTransport: HuggingFaceModelInfoTransport;
  hfDownloadTransport?: HuggingFaceDownloadTransport;
  excludeModelIds?: readonly string[];
}): Promise<ChutesModelPlan> {
  let catalog;
  try {
    catalog = await fetchChutesModelCatalog(
      chutesModelsListUrl(input.env),
      input.catalogTransport,
    );
  } catch (err) {
    const message =
      err instanceof ChutesCatalogError ? err.message : "Chutes model catalog request failed";
    throw new ChutesPreflightPlanError(message);
  }
  const forcedModel = input.env.LLM_MODEL?.trim();
  const refModel = catalog.models[0]?.id ?? forcedModel ?? "unknown/model";
  const maxPosts = maxPostsPerHandle(input.env, input.replay);
  const bootstrapCeilings = computeCeilings({
    handles: input.handles,
    question: input.question,
    referenceDate: input.referenceDate,
    maxRetrievedPostsPerHandle: maxPosts,
    modelId: refModel,
    contextLengthTokens: referenceContextLength(catalog.models),
    env: input.env,
  });
  const downloadTransport = input.hfDownloadTransport ?? createFetchHfDownloadTransport();
  let draft: ChutesModelPlan;
  try {
    draft = await buildChutesModelPlan({
      catalogModels: catalog.models,
      skippedCatalogEntries: catalog.skippedEntryCount,
      ceilings: bootstrapCeilings,
      env: input.env,
      hfTransport: input.hfTransport,
      forcedModelId: forcedModel === "" ? undefined : forcedModel,
      excludeModelIds: input.excludeModelIds,
    });
  } catch (err) {
    const message =
      err instanceof ChutesModelSelectionError ? err.message : "Chutes model selection failed";
    throw new ChutesPreflightPlanError(message);
  }

  for (const candidate of draft.candidates) {
    const model = candidate.model;
    const info = await input.hfTransport.fetchModelInfo(model.root);
    if (info === null) continue;
    let loaded;
    try {
      loaded = await loadTokenizerCache(model.root, info.sha, input.env, downloadTransport);
    } catch {
      continue;
    }
    const ceilings = computeCeilings({
      handles: input.handles,
      question: input.question,
      referenceDate: input.referenceDate,
      maxRetrievedPostsPerHandle: maxPosts,
      modelId: model.id,
      contextLengthTokens: model.contextLength,
      env: input.env,
      tokenizerJsonPath: loaded.tokenizerJsonPath,
    });
    if (!catalogEntryEligible(model, ceilings).ok) continue;
    if (worstCaseCostUsd(ceilings.inputTokensUpper, ceilings.outputTokensUpper, model.pricing) > LLM_CALL_BUDGET_USD) {
      continue;
    }
    applyTokenizerPinToEnv(input.env, loaded.tokenizerJsonPath, loaded.meta);
    try {
      return await buildChutesModelPlan({
        catalogModels: catalog.models,
        skippedCatalogEntries: catalog.skippedEntryCount,
        ceilings,
        env: input.env,
        hfTransport: input.hfTransport,
        forcedModelId: model.id,
        excludeModelIds: input.excludeModelIds,
      });
    } catch (err) {
      const message =
        err instanceof ChutesModelSelectionError ? err.message : "Chutes model selection failed";
      throw new ChutesPreflightPlanError(message);
    }
  }
  throw new ChutesPreflightPlanError("No eligible Chutes model is available");
}
