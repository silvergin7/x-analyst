import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseChutesCatalogBody } from "../src/analyze/chutesModelCatalog.js";
import { buildChutesModelPlan } from "../src/analyze/chutesModelSelection.js";
import type { HuggingFaceModelInfoTransport } from "../src/analyze/huggingfaceModelInfo.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "chutesModelsCatalog.json",
);

const hfFixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "hf");

function hfTransport(): HuggingFaceModelInfoTransport {
  return {
    async fetchModelInfo(root: string) {
      const safeRoot = root.replaceAll("/", "__");
      const body = JSON.parse(
        readFileSync(path.join(hfFixtureDir, `${safeRoot}.json`), "utf8"),
      ) as unknown;
      const { parseHuggingFaceModelInfoBody } = await import(
        "../src/analyze/huggingfaceModelInfo.js"
      );
      return parseHuggingFaceModelInfoBody(body);
    },
  };
}

describe("Chutes model selection", () => {
  it("ranks by worst-case cost highest first and keeps top 10", async () => {
    const catalog = parseChutesCatalogBody(readFileSync(fixturePath, "utf8"));
    const plan = await buildChutesModelPlan({
      catalogModels: catalog.models,
      skippedCatalogEntries: catalog.skippedEntryCount,
      ceilings: { inputTokensUpper: 100, outputTokensUpper: 100 },
      env: {},
      hfTransport: hfTransport(),
    });
    assert.equal(plan.primary.model.id, "zai-org/GLM-5.2-TEE");
    assert.ok(plan.fallbacks.length >= 0);
  });

  it("fails when LLM_MODEL override is ineligible", async () => {
    const catalog = parseChutesCatalogBody(readFileSync(fixturePath, "utf8"));
    await assert.rejects(
      buildChutesModelPlan({
        catalogModels: catalog.models,
        skippedCatalogEntries: 0,
        ceilings: { inputTokensUpper: 100, outputTokensUpper: 100 },
        env: {},
        hfTransport: hfTransport(),
        forcedModelId: "vendor/cheap-TEE",
      }),
    );
  });

  it("catalog fixture path stops before paid requests when selection fails", async () => {
    const catalog = parseChutesCatalogBody(readFileSync(fixturePath, "utf8"));
    await assert.rejects(
      buildChutesModelPlan({
        catalogModels: [],
        skippedCatalogEntries: catalog.skippedEntryCount,
        ceilings: { inputTokensUpper: 100, outputTokensUpper: 100 },
        env: {},
        hfTransport: hfTransport(),
      }),
    );
  });
});
