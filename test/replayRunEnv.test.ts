import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_VENDOR_TOKENIZER_DIR } from "../src/analyze/qwenTokenizerPins.js";
import { saveSlice, outcomesForSlice } from "../src/runtime/savedSlice.js";
import {
  chutesLiveEnvLooksDisabled,
  stripDesearchForReplayRun,
} from "../src/runtime/replayRunEnv.js";
import type { FetchOutcome } from "../src/types.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const vendorReady =
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer.json`) &&
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer_config.json`);

function chutesOnlyEnvLines(extra: string[] = []): string[] {
  return [
    "ANALYSIS_PROVIDER=chutes",
    "LLM_LIVE_ENABLED=true",
    "CHUTES_API_KEY=unit-test-only-not-a-secret",
    "CHUTES_CHAT_COMPLETIONS_URL=http://127.0.0.1:9/v1/chat/completions",
    ...extra,
  ];
}

function minimalShellEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? tmpdir(),
    X_ANALYST_SLICE_DIR:
      process.env.X_ANALYST_SLICE_DIR ??
      mkdtempSync(path.join(tmpdir(), "x-analyst-cli-slices-")),
    X_ANALYST_REPORTS_DIR:
      process.env.X_ANALYST_REPORTS_DIR ??
      mkdtempSync(path.join(tmpdir(), "x-analyst-cli-reports-")),
    ...extra,
  };
}

function sliceForBullmacro(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-replay-slice-"));
  const outcome: FetchOutcome = {
    status: "ok",
    handle: "bullmacro",
    retrievalComplete: true,
    posts: [
      {
        id: "p1",
        authorHandle: "bullmacro",
        text: "Growth remains constructive.",
        timestamp: "2026-09-20T14:00:00.000Z",
        url: "https://fixture.x-analyst.local/status/p1",
        kind: "original",
      },
    ],
  };
  return saveSlice(dir, {
    version: 1,
    fetchedAt: "2026-11-02T12:00:00.000Z",
    fetchedCommit: "d".repeat(40),
    referenceDate: "2026-11-02",
    handles: ["bullmacro"],
    postsSource: "fixtures",
    outcomes: outcomesForSlice([outcome]),
  });
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
  it("passes the replay gate with chutes-only env and reaches preflight", { skip: !vendorReady }, () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-replay-gate-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(envFile, chutesOnlyEnvLines().join("\n"), "utf8");
    const slicePath = sliceForBullmacro();
    const result = spawnSync(
      "npm",
      [
        "run",
        "analyze",
        "--",
        "--yes",
        "--handles",
        "bullmacro",
        "--replay",
        slicePath,
        "--as-of",
        "2026-11-02",
        "--env-file",
        envFile,
      ],
      {
        cwd: repoRoot,
        env: minimalShellEnv(),
        encoding: "utf8",
      },
    );
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
    const result = spawnSync(
      "npm",
      [
        "run",
        "analyze",
        "--",
        "--yes",
        "--handles",
        "bullmacro",
        "--env-file",
        envFile,
      ],
      {
        cwd: repoRoot,
        env: minimalShellEnv(),
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr + result.stdout,
      /Live providers are not fully enabled/,
    );
  });

  it("replays a slice with retrieval_failed without calling Desearch", { skip: !vendorReady }, () => {
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
    const result = spawnSync(
      "npm",
      [
        "run",
        "analyze",
        "--",
        "--yes",
        "--handles",
        "bullmacro",
        "--replay",
        slicePath,
        "--as-of",
        "2026-11-02",
        "--env-file",
        envFile,
      ],
      { cwd: repoRoot, env: minimalShellEnv(), encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /retrieval failed/i);
  });

  it("does not require Desearch keys in the env file for replay", { skip: !vendorReady }, () => {
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
    const result = spawnSync(
      "npm",
      [
        "run",
        "analyze",
        "--",
        "--yes",
        "--handles",
        "bullmacro",
        "--replay",
        slicePath,
        "--as-of",
        "2026-11-02",
        "--env-file",
        envFile,
      ],
      {
        cwd: repoRoot,
        env: minimalShellEnv(),
        encoding: "utf8",
      },
    );
    assert.doesNotMatch(
      result.stderr + result.stdout,
      /Live providers are not fully enabled/,
    );
  });
});
