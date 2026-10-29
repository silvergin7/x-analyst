import type { ChutesCatalogModel } from "./chutesModelCatalog.js";
import {
  catalogEntryEligible,
  hfInfoEligible,
  worstCaseCostUsd,
  type HandleTokenCeilings,
} from "./chutesModelEligibility.js";
import type { HuggingFaceModelInfoTransport } from "./huggingfaceModelInfo.js";
import { readChutesModelState } from "./chutesModelState.js";

export interface ChutesModelCandidate {
  model: ChutesCatalogModel;
  rank: number;
  worstCaseUsdPerHandle: number;
}

export interface ChutesModelPlan {
  skippedCatalogEntries: number;
  candidates: ChutesModelCandidate[];
  primary: ChutesModelCandidate;
  fallbacks: ChutesModelCandidate[];
  priorValidReport: boolean;
}

export class ChutesModelSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChutesModelSelectionError";
  }
}

function rankEligible(
  models: ChutesCatalogModel[],
  ceilings: HandleTokenCeilings,
): ChutesCatalogModel[] {
  const eligible: ChutesCatalogModel[] = [];
  for (const model of models) {
    if (catalogEntryEligible(model, ceilings).ok) {
      eligible.push(model);
    }
  }
  eligible.sort((a, b) => {
    const costA = worstCaseCostUsd(
      ceilings.inputTokensUpper,
      ceilings.outputTokensUpper,
      a.pricing,
    );
    const costB = worstCaseCostUsd(
      ceilings.inputTokensUpper,
      ceilings.outputTokensUpper,
      b.pricing,
    );
    if (costA !== costB) return costB - costA;
    return a.id.localeCompare(b.id);
  });
  return eligible.slice(0, 10);
}

function applySticky(
  ranked: ChutesCatalogModel[],
  state: ReturnType<typeof readChutesModelState>,
): ChutesCatalogModel[] {
  if (ranked.length === 0 || state === null) return ranked;
  const stickyId = state.lastValidModel;
  const index = ranked.findIndex((model) => model.id === stickyId);
  if (index <= 0) return ranked;
  const next = [...ranked];
  const [sticky] = next.splice(index, 1);
  next.unshift(sticky!);
  return next;
}

function toCandidates(
  models: ChutesCatalogModel[],
  ceilings: HandleTokenCeilings,
): ChutesModelCandidate[] {
  return models.map((model, index) => ({
    model,
    rank: index + 1,
    worstCaseUsdPerHandle: worstCaseCostUsd(
      ceilings.inputTokensUpper,
      ceilings.outputTokensUpper,
      model.pricing,
    ),
  }));
}

export async function buildChutesModelPlan(input: {
  catalogModels: readonly ChutesCatalogModel[];
  skippedCatalogEntries: number;
  ceilings: HandleTokenCeilings;
  env: NodeJS.ProcessEnv;
  hfTransport: HuggingFaceModelInfoTransport;
  forcedModelId?: string;
  excludeModelIds?: readonly string[];
}): Promise<ChutesModelPlan> {
  const forcedId = input.forcedModelId?.trim();
  const excluded = new Set(input.excludeModelIds ?? []);
  let pool = input.catalogModels.filter((model) => !excluded.has(model.id));
  if (forcedId !== undefined && forcedId !== "") {
    const match = pool.find((model) => model.id === forcedId);
    if (match === undefined) {
      throw new ChutesModelSelectionError(`LLM_MODEL ${forcedId} is not on the Chutes catalog`);
    }
    pool = [match];
  }

  const catalogEligible = pool.filter(
    (model) => catalogEntryEligible(model, input.ceilings).ok,
  );
  const hfChecked: ChutesCatalogModel[] = [];
  for (const model of catalogEligible) {
    const info = await input.hfTransport.fetchModelInfo(model.root);
    if (hfInfoEligible(info)) {
      hfChecked.push(model);
    }
  }

  if (forcedId !== undefined && forcedId !== "") {
    if (hfChecked.length === 0) {
      throw new ChutesModelSelectionError(`LLM_MODEL ${forcedId} is not eligible`);
    }
    const candidates = toCandidates(hfChecked, input.ceilings);
    const primary = candidates[0]!;
    const state = readChutesModelState(input.env);
    return {
      skippedCatalogEntries: input.skippedCatalogEntries,
      candidates,
      primary,
      fallbacks: [],
      priorValidReport: state?.validModels.includes(primary.model.id) ?? false,
    };
  }

  const ranked = rankEligible(hfChecked, input.ceilings);
  const stickyRanked = applySticky(ranked, readChutesModelState(input.env));
  if (stickyRanked.length === 0) {
    throw new ChutesModelSelectionError("No eligible Chutes model is available");
  }
  const candidates = toCandidates(stickyRanked, input.ceilings);
  const primary = candidates[0]!;
  const fallbacks = candidates.slice(1);
  const state = readChutesModelState(input.env);
  return {
    skippedCatalogEntries: input.skippedCatalogEntries,
    candidates,
    primary,
    fallbacks,
    priorValidReport: state?.validModels.includes(primary.model.id) ?? false,
  };
}
