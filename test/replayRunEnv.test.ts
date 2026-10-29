import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { saveSlice, outcomesForSlice } from "../src/runtime/savedSlice.js";
import {
  chutesLiveEnvLooksDisabled,
  stripDesearchForReplayRun,
} from "../src/runtime/replayRunEnv.js";
import type { FetchOutcome } from "../src/types.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
import { spawnAnalyzeWithFixtureDeps } from "./support/spawnAnalyzeWithFixtureDeps.js";

function chutesOnlyEnvLines(extra: string[] = []): string[] {
  return [
    "ANALYSIS_PROVIDER=chutes",
    "LLM_LIVE_ENABLED=true",
    "CHUTES_API_KEY=unit-test-only-not-a-secret",
    "CHUTES_CHAT_COMPLETIONS_URL=http://127.0.0.1:9/v1/chat/completions",
    ...extra,
  ];
}

function sliceWithPosts(handle: string, count: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-replay-slice-"));
  const outcome: FetchOutcome = {
    status: "ok",
    handle,
    retrievalComplete: true,
    posts: Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      authorHandle: handle,
      text: "Risk assets can still reprice if growth cools from here.",
      timestamp: "2026-09-20T14:00:00.000Z",
      url: `https://fixture.x-analyst.local/status/p${index}`,
      kind: "original" as const,
    })),
  };
  return saveSlice(dir, {
    version: 1,
    fetchedAt: "2026-11-02T12:00:00.000Z",
    fetchedCommit: "d".repeat(40),
    referenceDate: "2026-11-02",
    handles: [handle],
    postsSource: "fixtures",
    outcomes: outcomesForSlice([outcome]),
  });
}

function sliceForBullmacro(): string {
  return sliceWithPosts("bullmacro", 1);
}

function perHandleWorstCaseUsd(stdout: string): number {
  const match = stdout.match(/worst-case \$([0-9.]+) per handle/);
  assert.ok(match, stdout);
  return Number(match[1]);
}

describe("replay run env", () => {
  it("allows chutes-only env for replay gate checks", () => {
    assert.equal(
      chutesLiveEnvLooksDisabled({
        ANALYSIS_PROVIDER: "chutes",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "unit-test-only-not-a-secret",
      }),
      false,
    );
    assert.equal(
      chutesLiveEnvLooksDisabled({
        ANALYSIS_PROVIDER: "chutes",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "",
      }),
      true,
    );
  });

  it("clears Desearch credentials before runReport on replay", () => {
    const stripped = stripDesearchForReplayRun({
      DESEARCH_API_KEY: "must-not-pass-through",
      DESEARCH_LIVE_ENABLED: "true",
      CHUTES_API_KEY: "keep",
    });
    assert.equal(stripped.DESEARCH_API_KEY, "");
    assert.equal(stripped.DESEARCH_LIVE_ENABLED, "false");
    assert.equal(stripped.CHUTES_API_KEY, "keep");
  });

  it("analyzeCli strips Desearch credentials after confirmation on replay runs", () => {
    const source = readFileSync(path.join(repoRoot, "src/analyzeCli.ts"), "utf8");
    assert.match(source, /stripDesearchForReplayRun\(runEnv\)/);
  });
});

describe("npm run analyze replay gate", () => {
  it("passes the replay gate with chutes-only env and reaches preflight", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-replay-gate-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const slicePath = sliceForBullmacro();
    const result = spawnAnalyzeWithFixtureDeps([
      "--yes",
      "--handles",
      "bullmacro",
      "--replay",
      slicePath,
      "--as-of",
      "2026-11-02",
      "--env-file",
      envFile,
    ]);
    assert.doesNotMatch(
      result.stderr + result.stdout,
      /Live providers are not fully enabled/,
    );
    assert.doesNotMatch(
      result.stderr + result.stdout,
      /Replay requires Chutes live settings/,
    );
    assert.match(result.stdout, /Chutes host: http:\/\/127\.0\.0\.1:9/);
    assert.doesNotMatch(result.stdout, /Desearch host:/);
  });

  it("stops a live non-replay run when Desearch settings are missing", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-live-desearch-missing-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const result = spawnAnalyzeWithFixtureDeps([
      "--yes",
      "--handles",
      "bullmacro",
      "--env-file",
      envFile,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr + result.stdout,
      /Live providers are not fully enabled/,
    );
  });

  it("stops a retrieval_failed slice with no usable posts before any Desearch call", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-replay-failed-"));
    const slicePath = saveSlice(dir, {
      version: 1,
      fetchedAt: "2026-11-02T12:00:00.000Z",
      fetchedCommit: "e".repeat(40),
      referenceDate: "2026-11-02",
      handles: ["bullmacro"],
      postsSource: "desearch",
      outcomes: outcomesForSlice([
        {
          status: "retrieval_failed",
          handle: "bullmacro",
          failureCategory: "http_status",
          httpStatus: 404,
          reason: "Desearch request failed (HTTP 404).",
        },
      ]),
    });
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-replay-failed-env-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const result = spawnAnalyzeWithFixtureDeps([
      "--yes",
      "--handles",
      "bullmacro",
      "--replay",
      slicePath,
      "--as-of",
      "2026-11-02",
      "--env-file",
      envFile,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Replay slice has no usable posts\. No request was sent\./);
    assert.doesNotMatch(result.stdout + result.stderr, /Desearch host:/);
  });

  it("does not require Desearch keys in the env file for replay", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-replay-no-desearch-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(
      envFile,
      chutesOnlyEnvLines([
        "DESEARCH_API_KEY=must-not-be-required-for-gate",
        "DESEARCH_LIVE_ENABLED=true",
        "POSTS_PROVIDER=desearch",
      ]).join("\n"),
      "utf8",
    );
    const slicePath = sliceForBullmacro();
    const result = spawnAnalyzeWithFixtureDeps([
      "--yes",
      "--handles",
      "bullmacro",
      "--replay",
      slicePath,
      "--as-of",
      "2026-11-02",
      "--env-file",
      envFile,
    ]);
    assert.doesNotMatch(
      result.stderr + result.stdout,
      /Live providers are not fully enabled/,
    );
  });

  it("replay preflight estimate is higher for 61 saved posts than for 55", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-replay-counts-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const run = (count: number) =>
      spawnAnalyzeWithFixtureDeps([
        "--yes",
        "--handles",
        "bullmacro",
        "--replay",
        sliceWithPosts("bullmacro", count),
        "--as-of",
        "2026-11-02",
        "--env-file",
        envFile,
      ]);
    const sixtyOne = perHandleWorstCaseUsd(run(61).stdout);
    const fiftyFive = perHandleWorstCaseUsd(run(55).stdout);
    assert.ok(sixtyOne > fiftyFive);
  });

  it("stops a replay whose handles do not match before Proceed", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-replay-mismatch-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const result = spawnAnalyzeWithFixtureDeps([
      "--handles",
      "bearmacro",
      "--replay",
      sliceWithPosts("bullmacro", 1),
      "--as-of",
      "2026-11-02",
      "--env-file",
      envFile,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Slice handles do not match this run\. No request was sent\./,
    );
    assert.doesNotMatch(result.stdout + result.stderr, /Proceed\?/);
    assert.doesNotMatch(result.stdout, /Chutes host:/);
  });

  it("stops a replay with no usable posts before Proceed", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-replay-empty-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-replay-empty-"));
    const outcome: FetchOutcome = {
      status: "incomplete",
      handle: "bullmacro",
      reason: "desearch_page_no_valid_posts",
    };
    const slicePath = saveSlice(dir, {
      version: 1,
      fetchedAt: "2026-11-02T12:00:00.000Z",
      fetchedCommit: "d".repeat(40),
      referenceDate: "2026-11-02",
      handles: ["bullmacro"],
      postsSource: "fixtures",
      outcomes: outcomesForSlice([outcome]),
    });
    const result = spawnAnalyzeWithFixtureDeps([
      "--handles",
      "bullmacro",
      "--replay",
      slicePath,
      "--as-of",
      "2026-11-02",
      "--env-file",
      envFile,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Replay slice has no usable posts\. No request was sent\./);
    assert.doesNotMatch(result.stdout + result.stderr, /Proceed\?/);
    assert.doesNotMatch(result.stdout, /Chutes host:/);
  });
});
