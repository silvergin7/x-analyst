import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { saveSlice, outcomesForSlice } from "../src/runtime/savedSlice.js";
import { existsSync } from "node:fs";
import { DEFAULT_VENDOR_TOKENIZER_DIR } from "../src/analyze/qwenTokenizerPins.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const vendorReady =
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer.json`) &&
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer_config.json`);

function chutesOnlyEnvLines(): string[] {
  return [
    "ANALYSIS_PROVIDER=chutes",
    "LLM_LIVE_ENABLED=true",
    "CHUTES_API_KEY=unit-test-only-not-a-secret",
    "CHUTES_CHAT_COMPLETIONS_URL=http://127.0.0.1:9/v1/chat/completions",
  ];
}

function minimalShellEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? tmpdir(),
    X_ANALYST_SLICE_DIR: mkdtempSync(path.join(tmpdir(), "x-analyst-exit-slices-")),
    X_ANALYST_REPORTS_DIR: mkdtempSync(path.join(tmpdir(), "x-analyst-exit-reports-")),
  };
}

function replaySlice(outcomes: Parameters<typeof outcomesForSlice>[0]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-exit-slice-"));
  return saveSlice(dir, {
    version: 1,
    fetchedAt: "2026-11-02T12:00:00.000Z",
    fetchedCommit: "f".repeat(40),
    referenceDate: "2026-11-02",
    handles: ["bullmacro"],
    postsSource: "desearch",
    outcomes: outcomesForSlice(outcomes),
  });
}

describe("analyze CLI exit code for fetch outcomes", () => {
  it("exits 1 on retrieval_failed replay", { skip: !vendorReady }, () => {
    const slicePath = replaySlice([
      {
        status: "retrieval_failed",
        handle: "bullmacro",
        failureCategory: "network",
        reason: "network down",
      },
    ]);
    const envFile = path.join(mkdtempSync(path.join(tmpdir(), "env-")), ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const result = spawnSync(
      "npm",
      ["run", "analyze", "--", "--yes", "--handles", "bullmacro", "--replay", slicePath, "--env-file", envFile],
      { cwd: repoRoot, env: minimalShellEnv(), encoding: "utf8" },
    );
    assert.equal(result.status, 1);
  });

  it("exits 1 on desearch_page_no_valid_posts incomplete replay", { skip: !vendorReady }, () => {
    const slicePath = replaySlice([
      { status: "incomplete", handle: "bullmacro", reason: "desearch_page_no_valid_posts" },
    ]);
    const envFile = path.join(mkdtempSync(path.join(tmpdir(), "env-")), ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const result = spawnSync(
      "npm",
      ["run", "analyze", "--", "--yes", "--handles", "bullmacro", "--replay", slicePath, "--env-file", envFile],
      { cwd: repoRoot, env: minimalShellEnv(), encoding: "utf8" },
    );
    assert.equal(result.status, 1);
  });

  it("exits 1 on desearch_retrieval_interrupted partial ok replay", { skip: !vendorReady }, () => {
    const slicePath = replaySlice([
      {
        status: "ok",
        handle: "bullmacro",
        posts: [
          {
            id: "p1",
            authorHandle: "bullmacro",
            timestamp: "2026-10-09T00:00:00.000Z",
            url: "https://fixture.x-analyst.local/p1",
            kind: "original",
            text: "Constructive macro tone.",
          },
        ],
        retrievalComplete: false,
        incompleteReason: "desearch_retrieval_interrupted",
        failureCategory: "timeout",
        reason: "Desearch request timed out.",
      },
    ]);
    const envFile = path.join(mkdtempSync(path.join(tmpdir(), "env-")), ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const result = spawnSync(
      "npm",
      ["run", "analyze", "--", "--yes", "--handles", "bullmacro", "--replay", slicePath, "--env-file", envFile],
      { cwd: repoRoot, env: minimalShellEnv(), encoding: "utf8" },
    );
    assert.equal(result.status, 1);
  });

  it("exits 0 on request budget exhaustion incomplete replay", { skip: !vendorReady }, () => {
    const slicePath = replaySlice([
      { status: "incomplete", handle: "bullmacro", reason: "desearch_request_budget_exhausted" },
    ]);
    const envFile = path.join(mkdtempSync(path.join(tmpdir(), "env-")), ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const result = spawnSync(
      "npm",
      ["run", "analyze", "--", "--yes", "--handles", "bullmacro", "--replay", slicePath, "--env-file", envFile],
      { cwd: repoRoot, env: minimalShellEnv(), encoding: "utf8" },
    );
    assert.equal(result.status, 0);
  });
});
