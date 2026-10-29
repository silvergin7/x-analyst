import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { forbiddenTestFixtureEnvMessage } from "../src/analyze/testFixtureEnvGuard.js";
import { spawnAnalyzeWithFixtureDeps } from "./support/spawnAnalyzeWithFixtureDeps.js";

describe("test fixture env guard", () => {
  it("rejects live analyze when CHUTES_CATALOG_FIXTURE_PATH is set", () => {
    const message = forbiddenTestFixtureEnvMessage({
      CHUTES_CATALOG_FIXTURE_PATH: "/tmp/catalog.json",
    });
    assert.match(message ?? "", /CHUTES_CATALOG_FIXTURE_PATH/);
  });

  it("prints Preflight error for replay when HF_MODEL_INFO_FIXTURE_DIR is set", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "fixture-guard-env-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(
      envFile,
      [
        "ANALYSIS_PROVIDER=chutes",
        "LLM_LIVE_ENABLED=true",
        "CHUTES_API_KEY=unit-test-only-not-a-secret",
      ].join("\n"),
      "utf8",
    );
    const result = spawnAnalyzeWithFixtureDeps(
      [
        "--yes",
        "--handles",
        "bullmacro",
        "--replay",
        "/missing/slice.json",
        "--env-file",
        envFile,
      ],
      {
        HF_MODEL_INFO_FIXTURE_DIR: "/tmp/hf",
      },
    );
    assert.match(result.stderr + result.stdout, /Preflight error:.*HF_MODEL_INFO_FIXTURE_DIR/);
  });
});
