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
import type { HuggingFaceModelInfoTransport } from "./huggingfaceModelInfo.js";
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
  const sample = sampleDesearchRequest();
  return 20 * requestsPerHandle;
}

function referenceContextLength(models: readonly ChutesCatalogModel[]): number {
  let max = 0;
  for (const model of models) {
    if (model.contextLength > max) max = model.contextLength;
  }
  return max > 0 ? max : 131_072;
}

export async function buildChutesModelPlanForRun(input: {
  env: NodeJS.ProcessEnv;
  handles: readonly string[];
  question: string;
  referenceDate: string;
  replay: boolean;
  catalogTransport: ChutesCatalogTransport;
  hfTransport: HuggingFaceModelInfoTransport;
}): Promise<ChutesModelPlan> {
  let catalog;
  try {
    catalog = await fetchChutesModelCatalog(
      chutesModelsListUrl(input.env),
      input.catalogTransport,
      input.env,
    );
  } catch (err) {
    const message =
      err instanceof ChutesCatalogError ? err.message : "Chutes model catalog request failed";
    throw new ChutesPreflightPlanError(message);
  }
  const forcedModel = input.env.LLM_MODEL?.trim();
  const refModel = catalog.models[0]?.id ?? forcedModel ?? "unknown/model";
  const ceilings = input.handles.reduce(
    (acc, handle) => {
      const next = worstCaseHandleCeilings({
        handle,
        question: input.question,
        referenceDate: input.referenceDate,
        maxRetrievedPostsPerHandle: maxPostsPerHandle(input.env, input.replay),
        modelId: refModel,
        contextLengthTokens: referenceContextLength(catalog.models),
        env: input.env,
      });
      return {
        inputTokensUpper: Math.max(acc.inputTokensUpper, next.inputTokensUpper),
        outputTokensUpper: Math.max(acc.outputTokensUpper, next.outputTokensUpper),
      };
    },
    { inputTokensUpper: 0, outputTokensUpper: 0 },
  );
  try {
    return await buildChutesModelPlan({
      catalogModels: catalog.models,
      skippedCatalogEntries: catalog.skippedEntryCount,
      ceilings,
      env: input.env,
      hfTransport: input.hfTransport,
      forcedModelId: forcedModel === "" ? undefined : forcedModel,
    });
  } catch (err) {
    const message =
      err instanceof ChutesModelSelectionError ? err.message : "Chutes model selection failed";
    throw new ChutesPreflightPlanError(message);
  }
}
