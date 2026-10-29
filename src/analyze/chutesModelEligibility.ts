import {
  LLM_CALL_BUDGET_USD,
  LLM_THINKING_ALLOWANCE_TOKENS,
} from "../config/llmSettings.js";
import type { ChutesCatalogModel, ChutesModelPricing } from "./chutesModelCatalog.js";
import { hasPublicTokenizerJson, type HuggingFaceModelInfo } from "./huggingfaceModelInfo.js";

export const CHUTES_MODEL_ROOT_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;

export interface HandleTokenCeilings {
  inputTokensUpper: number;
  outputTokensUpper: number;
}

export function worstCaseCostUsd(
  inputTokensUpper: number,
  outputTokensUpper: number,
  pricing: ChutesModelPricing,
): number {
  const outputWithThinking = outputTokensUpper + LLM_THINKING_ALLOWANCE_TOKENS;
  return (
    (inputTokensUpper * pricing.promptUsdPerMillion) / 1_000_000 +
    (outputWithThinking * pricing.completionUsdPerMillion) / 1_000_000
  );
}

export type CatalogEligibilityFailure =
  | "pricing"
  | "structured_outputs"
  | "reasoning"
  | "confidential_compute"
  | "context_length"
  | "max_output_length"
  | "worst_case_cost"
  | "invalid_root";

export function catalogEntryEligible(
  model: ChutesCatalogModel,
  ceilings: HandleTokenCeilings,
): { ok: true } | { ok: false; reason: CatalogEligibilityFailure } {
  if (!CHUTES_MODEL_ROOT_PATTERN.test(model.root) || model.root.includes("..")) {
    return { ok: false, reason: "invalid_root" };
  }
  if (
    !Number.isFinite(model.pricing.promptUsdPerMillion) ||
    model.pricing.promptUsdPerMillion <= 0 ||
    !Number.isFinite(model.pricing.completionUsdPerMillion) ||
    model.pricing.completionUsdPerMillion <= 0
  ) {
    return { ok: false, reason: "pricing" };
  }
  const features = new Set(model.supportedFeatures);
  if (!features.has("structured_outputs")) {
    return { ok: false, reason: "structured_outputs" };
  }
  if (!features.has("reasoning")) {
    return { ok: false, reason: "reasoning" };
  }
  if (model.confidentialCompute !== true) {
    return { ok: false, reason: "confidential_compute" };
  }
  const outputWithThinking = ceilings.outputTokensUpper + LLM_THINKING_ALLOWANCE_TOKENS;
  if (model.contextLength < ceilings.inputTokensUpper + ceilings.outputTokensUpper + LLM_THINKING_ALLOWANCE_TOKENS) {
    return { ok: false, reason: "context_length" };
  }
  if (model.maxOutputLength < outputWithThinking) {
    return { ok: false, reason: "max_output_length" };
  }
  const cost = worstCaseCostUsd(
    ceilings.inputTokensUpper,
    ceilings.outputTokensUpper,
    model.pricing,
  );
  if (cost > LLM_CALL_BUDGET_USD) {
    return { ok: false, reason: "worst_case_cost" };
  }
  return { ok: true };
}

export function hfInfoEligible(info: HuggingFaceModelInfo | null): boolean {
  if (info === null) return false;
  return hasPublicTokenizerJson(info);
}
