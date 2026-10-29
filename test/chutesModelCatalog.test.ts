import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ChutesCatalogError,
  fetchChutesModelCatalog,
  parseChutesCatalogBody,
} from "../src/analyze/chutesModelCatalog.js";
import type { ChutesCatalogTransport } from "../src/analyze/chutesCatalogTransport.js";
import { CHUTES_CATALOG_MAX_BYTES } from "../src/config/llmSettings.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "chutesModelsCatalog.json",
);

function mockTransport(bodyText: string, status = 200): ChutesCatalogTransport {
  return {
    async get() {
      return { status, bodyText };
    },
  };
}

describe("Chutes model catalog", () => {
  it("parses valid entries and skips malformed ones", () => {
    const body = readFileSync(fixturePath, "utf8");
    const parsed = parseChutesCatalogBody(body);
    assert.equal(parsed.models.length, 2);
    assert.equal(parsed.skippedEntryCount, 2);
    assert.equal(parsed.models[0]!.id, "zai-org/GLM-5.2-TEE");
    assert.equal(parsed.models[0]!.pricing.promptUsdPerMillion, 0.5);
  });

  it("rejects invalid top-level shape", () => {
    assert.throws(
      () => parseChutesCatalogBody(JSON.stringify({ items: [] })),
      (err: unknown) => err instanceof ChutesCatalogError,
    );
  });

  it("fetch rejects non-200", async () => {
    await assert.rejects(
      fetchChutesModelCatalog("https://llm.chutes.ai/v1/models", mockTransport("{}", 503)),
      (err: unknown) => err instanceof ChutesCatalogError,
    );
  });

  it("fetch rejects oversize body", async () => {
    const huge = "x".repeat(CHUTES_CATALOG_MAX_BYTES + 1);
    await assert.rejects(
      fetchChutesModelCatalog("https://llm.chutes.ai/v1/models", mockTransport(huge)),
      (err: unknown) => err instanceof ChutesCatalogError,
    );
  });

  it("mutation: missing data array fails shape check", () => {
    assert.throws(
      () => parseChutesCatalogBody(JSON.stringify({ data: "not-array" })),
      (err: unknown) => err instanceof ChutesCatalogError,
    );
  });
});
