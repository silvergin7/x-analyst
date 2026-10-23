import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { DEFAULT_VENDOR_TOKENIZER_DIR } from "../src/analyze/qwenTokenizerPins.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const vendorReady =
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer.json`) &&
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer_config.json`);

const UNREACHABLE_PROVIDER_ENDPOINTS = [
  "DESEARCH_API_BASE=http://127.0.0.1:9",
  "CHUTES_CHAT_COMPLETIONS_URL=http://127.0.0.1:9/v1/chat/completions",
] as const;

function minimalShellEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const sliceDir =
    process.env.X_ANALYST_SLICE_DIR ??
    mkdtempSync(path.join(tmpdir(), "x-analyst-cli-slices-"));
  const reportsDir =
    process.env.X_ANALYST_REPORTS_DIR ??
    mkdtempSync(path.join(tmpdir(), "x-analyst-cli-reports-"));
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? tmpdir(),
    X_ANALYST_SLICE_DIR: sliceDir,
    X_ANALYST_REPORTS_DIR: reportsDir,
    ...extra,
  };
}

function spawnAnalyze(
  args: string[],
  input: { env?: NodeJS.ProcessEnv } = {},
) {
  return spawnSync("npm", ["run", "analyze", "--", ...args], {
    cwd: repoRoot,
    env: minimalShellEnv(input.env),
    encoding: "utf8",
  });
}

describe("npm run analyze", () => {
  it("runs offline through the npm script with a two-word question", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "analyze-out-"));
    const reportPath = path.join(outDir, "report.json");
    const result = spawnAnalyze([
      "--offline",
      "--yes",
      "--question",
      "two word",
      "--handles",
      "bullmacro",
      "--output",
      reportPath,
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Question: two word/);
    assert.match(result.stdout, new RegExp(`Report JSON: ${reportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  it("requires .env for live runs without --offline", () => {
    const missingEnv = path.join(mkdtempSync(path.join(tmpdir(), "analyze-env-")), "missing.env");
    const result = spawnAnalyze([
      "--yes",
      "--handles",
      "bullmacro",
      "--env-file",
      missingEnv,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /\.env|environment file/);
  });

  it("stops in preflight when the pinned tokenizer is not installed", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-no-tokenizer-"));
    const badTokenizerDir = mkdtempSync(path.join(tmpdir(), "bad-tokenizer-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(
      envFile,
      [
        "POSTS_PROVIDER=desearch",
        "DESEARCH_LIVE_ENABLED=true",
        "DESEARCH_API_KEY=unit-test-only-not-a-secret",
        "DESEARCH_MAX_REQUESTS_PER_RUN=5",
        "DESEARCH_MAX_REQUESTS_PER_HANDLE=3",
        "ANALYSIS_PROVIDER=chutes",
        "LLM_LIVE_ENABLED=true",
        "CHUTES_API_KEY=unit-test-only-not-a-secret",
        `LLM_TOKENIZER_DIR=${badTokenizerDir}`,
        ...UNREACHABLE_PROVIDER_ENDPOINTS,
      ].join("\n"),
      "utf8",
    );
    const result = spawnAnalyze(["--yes", "--handles", "bullmacro", "--env-file", envFile], {
      env: minimalShellEnv({ LLM_TOKENIZER_DIR: badTokenizerDir }),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Preflight error:.*Qwen tokenizer files missing/);
    assert.doesNotMatch(result.stdout, /Proceed\?/);
    assert.doesNotMatch(result.stdout, /Report JSON:/);
  });

  it("stops on a non-tty live run without --yes before any transport", { skip: !vendorReady }, () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-live-gate-"));
    const envFile = path.join(envDir, ".env");
    writeFileSync(
      envFile,
      [
        "POSTS_PROVIDER=desearch",
        "DESEARCH_LIVE_ENABLED=true",
        "DESEARCH_API_KEY=unit-test-only-not-a-secret",
        "DESEARCH_MAX_REQUESTS_PER_RUN=5",
        "DESEARCH_MAX_REQUESTS_PER_HANDLE=3",
        "ANALYSIS_PROVIDER=chutes",
        "LLM_LIVE_ENABLED=true",
        "CHUTES_API_KEY=unit-test-only-not-a-secret",
        ...UNREACHABLE_PROVIDER_ENDPOINTS,
      ].join("\n"),
      "utf8",
    );
    const result = spawnAnalyze(["--handles", "bullmacro", "--env-file", envFile]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Stopped before any request/);
    assert.doesNotMatch(result.stdout, /Report JSON:/);
  });

  it("rejects invalid or duplicate --handles before preflight", () => {
    const invalid = spawnAnalyze(
      ["--offline", "--yes", "--handles", "bullmacro,bad handle"],
    );
    assert.notEqual(invalid.status, 0);
    assert.match(
      invalid.stderr + invalid.stdout,
      /Invalid handle "bad handle": handle must contain only letters, numbers, and underscore/,
    );
    assert.doesNotMatch(invalid.stdout, /DESEARCH_MAX_REQUESTS_PER_RUN:/);

    const duplicate = spawnAnalyze(
      ["--offline", "--yes", "--handles", "bullmacro,BullMacro"],
    );
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr + duplicate.stdout, /Invalid handle "BullMacro": duplicate handle/);
  });
});
