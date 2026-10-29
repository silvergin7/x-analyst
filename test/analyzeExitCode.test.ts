import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { saveSlice, outcomesForSlice } from "../src/runtime/savedSlice.js";
import { spawnAnalyzeWithFixtureDeps } from "./support/spawnAnalyzeWithFixtureDeps.js";

function chutesOnlyEnvLines(): string[] {
  return [
    "ANALYSIS_PROVIDER=chutes",
    "LLM_LIVE_ENABLED=true",
    "CHUTES_API_KEY=unit-test-only-not-a-secret",
    "CHUTES_CHAT_COMPLETIONS_URL=http://127.0.0.1:9/v1/chat/completions",
  ];
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
  it("exits 1 on retrieval_failed replay", () => {
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
    const result = spawnAnalyzeWithFixtureDeps([
      "--yes",
      "--handles",
      "bullmacro",
      "--replay",
      slicePath,
      "--env-file",
      envFile,
    ]);
    assert.equal(result.status, 1);
  });

  it("exits 1 on desearch_page_no_valid_posts incomplete replay", () => {
    const slicePath = replaySlice([
      { status: "incomplete", handle: "bullmacro", reason: "desearch_page_no_valid_posts" },
    ]);
    const envFile = path.join(mkdtempSync(path.join(tmpdir(), "env-")), ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const result = spawnAnalyzeWithFixtureDeps([
      "--yes",
      "--handles",
      "bullmacro",
      "--replay",
      slicePath,
      "--env-file",
      envFile,
    ]);
    assert.equal(result.status, 1);
  });

  it("exits 1 on desearch_retrieval_interrupted partial ok replay", () => {
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
    const result = spawnAnalyzeWithFixtureDeps([
      "--yes",
      "--handles",
      "bullmacro",
      "--replay",
      slicePath,
      "--env-file",
      envFile,
    ]);
    assert.equal(result.status, 1);
  });

  it("stops a request-budget incomplete replay that has no usable posts", () => {
    const slicePath = replaySlice([
      { status: "incomplete", handle: "bullmacro", reason: "desearch_request_budget_exhausted" },
    ]);
    const envFile = path.join(mkdtempSync(path.join(tmpdir(), "env-")), ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const result = spawnAnalyzeWithFixtureDeps([
      "--yes",
      "--handles",
      "bullmacro",
      "--replay",
      slicePath,
      "--env-file",
      envFile,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Replay slice has no usable posts\. No request was sent\./);
  });
});
