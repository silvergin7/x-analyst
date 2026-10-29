import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { readInputMaxCharsStrict } from "../src/config/llmSettings.js";
import { ReportConfigError, runReport } from "../src/runReport.js";
import { createFetchSliceCache } from "../src/runtime/fetchCache.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

describe("readInputMaxCharsStrict", () => {
  it("accepts empty and rejects malformed values", () => {
    assert.equal(readInputMaxCharsStrict({ LLM_INPUT_MAX_CHARS: "" }).ok, true);
    assert.equal(readInputMaxCharsStrict({ LLM_INPUT_MAX_CHARS: "20000" }).ok, true);
    assert.equal(readInputMaxCharsStrict({ LLM_INPUT_MAX_CHARS: "nope" }).ok, false);
    assert.equal(readInputMaxCharsStrict({ LLM_INPUT_MAX_CHARS: "0" }).ok, false);
  });

  it("mutation: malformed values must not pass", () => {
    assert.equal(readInputMaxCharsStrict({ LLM_INPUT_MAX_CHARS: "12.5" }).ok, false);
  });
});

describe("runReport LLM_INPUT_MAX_CHARS gate", () => {
  it("stops before fetch when the value is malformed", async () => {
    await assert.rejects(
      () =>
        runReport(["bullmacro"], { text: "Outlook?" }, {
          referenceDate: "2026-11-02",
          env: {
            POSTS_PROVIDER: "mock",
            ANALYSIS_PROVIDER: "mock",
            LLM_INPUT_MAX_CHARS: "nope",
            X_ANALYST_SLICE_DIR: mkdtempSync(path.join(tmpdir(), "slice-")),
          },
          cache: createFetchSliceCache(),
        }),
      (err: unknown) =>
        err instanceof ReportConfigError && /LLM_INPUT_MAX_CHARS is malformed/.test(err.message),
    );
  });
});

describe("analyze CLI LLM_INPUT_MAX_CHARS gate", () => {
  it("fails before confirmation when the value is malformed", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-bad-input-"));
    writeFileSync(
      path.join(envDir, ".env"),
      [
        "POSTS_PROVIDER=mock",
        "ANALYSIS_PROVIDER=mock",
        "LLM_INPUT_MAX_CHARS=nope",
      ].join("\n"),
      "utf8",
    );
    const result = spawnSync(
      "npm",
      ["run", "analyze", "--", "--offline", "--handles", "bullmacro", "--env-file", path.join(envDir, ".env")],
      {
        cwd: repoRoot,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? tmpdir(),
          X_ANALYST_SLICE_DIR: mkdtempSync(path.join(tmpdir(), "slice-")),
          X_ANALYST_REPORTS_DIR: mkdtempSync(path.join(tmpdir(), "reports-")),
        },
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /LLM_INPUT_MAX_CHARS is malformed/);
    assert.doesNotMatch(result.stdout, /Proceed\?/);
  });

  it("offline with --env-file does not call live providers when live flags are present", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-offline-env-"));
    writeFileSync(
      path.join(envDir, ".env"),
      [
        "POSTS_PROVIDER=desearch",
        "DESEARCH_LIVE_ENABLED=true",
        "DESEARCH_API_KEY=would-be-secret",
        "ANALYSIS_PROVIDER=chutes",
        "LLM_LIVE_ENABLED=true",
        "CHUTES_API_KEY=would-be-secret",
      ].join("\n"),
      "utf8",
    );
    const result = spawnSync(
      "npm",
      [
        "run",
        "analyze",
        "--",
        "--yes",
        "--offline",
        "--handles",
        "bullmacro",
        "--env-file",
        path.join(envDir, ".env"),
      ],
      {
        cwd: repoRoot,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? tmpdir(),
          X_ANALYST_SLICE_DIR: mkdtempSync(path.join(tmpdir(), "slice-")),
          X_ANALYST_REPORTS_DIR: mkdtempSync(path.join(tmpdir(), "reports-")),
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0);
    const combined = result.stderr + result.stdout;
    assert.match(combined, /Chutes: not used \(offline\)/);
    assert.doesNotMatch(combined, /would-be-secret/);
    assert.doesNotMatch(combined, /Provider usage/);
  });
});
