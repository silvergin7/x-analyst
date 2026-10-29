import type { ChutesModelPlan } from "../../src/analyze/chutesModelSelection.js";
import { TEST_CHUTES_MODEL_ID } from "./chutesTestModel.js";

export function testChutesModelPlan(
  overrides: Partial<ChutesModelPlan> = {},
): ChutesModelPlan {
  const model = {
    id: TEST_CHUTES_MODEL_ID,
    root: "zai-org/GLM-5.2",
    pricing: { promptUsdPerMillion: 0.5, completionUsdPerMillion: 2 },
    contextLength: 131_072,
    maxOutputLength: 65_536,
    supportedFeatures: ["structured_outputs", "reasoning"],
    confidentialCompute: true,
  };
  const primary = {
    model,
    rank: 1,
    worstCaseUsdPerHandle: 0.01,
  };
  return {
    skippedCatalogEntries: 0,
    candidates: [primary],
    primary,
    fallbacks: [],
    priorValidReport: false,
    ...overrides,
  };
}
