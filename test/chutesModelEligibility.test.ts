import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChutesCatalogModel } from "../src/analyze/chutesModelCatalog.js";
import {
  catalogEntryEligible,
  hfInfoEligible,
  worstCaseCostUsd,
} from "../src/analyze/chutesModelEligibility.js";
import { LLM_CALL_BUDGET_USD, LLM_THINKING_ALLOWANCE_TOKENS } from "../src/config/llmSettings.js";
import { hasPublicTokenizerJson } from "../src/analyze/huggingfaceModelInfo.js";

const ceilings = { inputTokensUpper: 5000, outputTokensUpper: 3000 };

function baseModel(overrides: Partial<ChutesCatalogModel> = {}): ChutesCatalogModel {
  return {
    id: "org/model-TEE",
    root: "org/model",
    pricing: { promptUsdPerMillion: 0.5, completionUsdPerMillion: 2 },
    contextLength: 200_000,
    maxOutputLength: 50_000,
    supportedFeatures: ["structured_outputs", "reasoning"],
    confidentialCompute: true,
    ...overrides,
  };
}

describe("Chutes model eligibility", () => {
  it("requires positive finite pricing", () => {
    assert.equal(catalogEntryEligible(baseModel({ pricing: { promptUsdPerMillion: 0, completionUsdPerMillion: 1 } }), ceilings).ok, false);
    assert.equal(catalogEntryEligible(baseModel({ pricing: { promptUsdPerMillion: 1, completionUsdPerMillion: -1 } }), ceilings).ok, false);
  });

  it("requires structured_outputs in supported_features", () => {
    assert.equal(
      catalogEntryEligible(
        baseModel({ supportedFeatures: ["reasoning"] }),
        ceilings,
      ).ok,
      false,
    );
  });

  it("requires reasoning in supported_features", () => {
    assert.equal(
      catalogEntryEligible(
        baseModel({ supportedFeatures: ["structured_outputs"] }),
        ceilings,
      ).ok,
      false,
    );
  });

  it("requires confidential_compute true", () => {
    assert.equal(
      catalogEntryEligible(baseModel({ confidentialCompute: false }), ceilings).ok,
      false,
    );
  });

  it("requires sufficient context_length", () => {
    const need =
      ceilings.inputTokensUpper +
      ceilings.outputTokensUpper +
      LLM_THINKING_ALLOWANCE_TOKENS;
    assert.equal(
      catalogEntryEligible(baseModel({ contextLength: need - 1 }), ceilings).ok,
      false,
    );
  });

  it("requires sufficient max_output_length", () => {
    const need = ceilings.outputTokensUpper + LLM_THINKING_ALLOWANCE_TOKENS;
    assert.equal(
      catalogEntryEligible(baseModel({ maxOutputLength: need - 1 }), ceilings).ok,
      false,
    );
  });

  it("requires HF public tokenizer.json", () => {
    assert.equal(
      hfInfoEligible({
        sha: "a".repeat(40),
        gated: false,
        private: false,
        siblingFiles: ["config.json"],
      }),
      false,
    );
    assert.equal(
      hfInfoEligible({
        sha: "a".repeat(40),
        gated: true,
        private: false,
        siblingFiles: ["tokenizer.json"],
      }),
      false,
    );
  });

  it("requires worst case at or below per-call budget", () => {
    const expensive = baseModel({
      pricing: { promptUsdPerMillion: 100, completionUsdPerMillion: 100 },
    });
    assert.equal(catalogEntryEligible(expensive, ceilings).ok, false);
    const cost = worstCaseCostUsd(
      ceilings.inputTokensUpper,
      ceilings.outputTokensUpper,
      expensive.pricing,
    );
    assert.ok(cost > LLM_CALL_BUDGET_USD);
  });

  it("mutation: confidential_compute must be exactly true", () => {
    assert.equal(catalogEntryEligible(baseModel({ confidentialCompute: true }), ceilings).ok, true);
    assert.equal(catalogEntryEligible(baseModel({ confidentialCompute: false }), ceilings).ok, false);
  });

  it("mutation: hf gated false required", () => {
    assert.equal(hasPublicTokenizerJson({
      sha: "a".repeat(40),
      gated: false,
      private: false,
      siblingFiles: ["tokenizer.json"],
    }), true);
    assert.equal(hasPublicTokenizerJson({
      sha: "a".repeat(40),
      gated: true,
      private: false,
      siblingFiles: ["tokenizer.json"],
    }), false);
  });
});
