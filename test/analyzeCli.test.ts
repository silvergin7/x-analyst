import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildChutesModelPlanForRun,
  ChutesPreflightPlanError,
} from "../src/analyze/buildChutesModelPlanForRun.js";
import {
  createDirectoryHfModelInfoTransport,
  createFileCatalogTransport,
} from "./support/chutesFixtureTransports.js";
import { spawnAnalyzeWithFixtureDeps } from "./support/spawnAnalyzeWithFixtureDeps.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const catalogFixturePath = path.join(repoRoot, "test/fixtures/chutesModelsCatalog.json");
const hfFixtureDir = path.join(repoRoot, "test/fixtures/hf");

const UNREACHABLE_PROVIDER_ENDPOINTS = [
  "DESEARCH_API_BASE=http://127.0.0.1:9",
  "CHUTES_CHAT_COMPLETIONS_URL=http://127.0.0.1:9/v1/chat/completions",
] as const;

describe("npm run analyze", () => {
  it("runs offline through the npm script with a two-word question", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "analyze-out-"));
    const reportPath = path.join(outDir, "report.json");
    const result = spawnAnalyzeWithFixtureDeps([
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
    const result = spawnAnalyzeWithFixtureDeps([
      "--yes",
      "--handles",
      "bullmacro",
      "--env-file",
      missingEnv,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /\.env|environment file/);
  });

  it("stops in preflight when no catalog model can load a tokenizer", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "tokenizer-cache-empty-"));
    await assert.rejects(
      () =>
        buildChutesModelPlanForRun({
          env: {
            ...withTestEnv(),
            X_ANALYST_TOKENIZER_CACHE_DIR: cacheDir,
          },
          handles: ["bullmacro"],
          question: "What is the outlook?",
          referenceDate: "2026-10-10",
          postsPerHandle: [20],
          catalogTransport: createFileCatalogTransport(catalogFixturePath),
          hfTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
          hfDownloadTransport: {
            async get() {
              return { status: 404, body: Buffer.from("missing") };
            },
          },
        }),
      (err: unknown) =>
        err instanceof ChutesPreflightPlanError &&
        err.message === "No eligible Chutes model is available",
    );
  });

  it("stops on a non-tty live run without --yes before any transport", () => {
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
    const result = spawnAnalyzeWithFixtureDeps(["--handles", "bullmacro", "--env-file", envFile]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Stopped before any request/);
    assert.doesNotMatch(result.stdout, /Report JSON:/);
  });

  it("blocks non-https non-loopback overrides before Proceed on non-tty without --yes", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-https-block-"));
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
        "DESEARCH_API_BASE=http://not-loopback.example",
        "CHUTES_CHAT_COMPLETIONS_URL=http://127.0.0.1:9/v1/chat/completions",
      ].join("\n"),
      "utf8",
    );
    const result = spawnAnalyzeWithFixtureDeps(["--handles", "bullmacro", "--env-file", envFile]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Preflight error: DESEARCH_API_BASE must use https/);
    assert.doesNotMatch(result.stderr + result.stdout, /not-loopback\.example/);
    assert.doesNotMatch(result.stdout, /Proceed\?/);
    assert.doesNotMatch(result.stdout, /Report JSON:/);
  });

  it("shows override warnings with --yes before any request", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "analyze-warn-yes-"));
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
    const result = spawnAnalyzeWithFixtureDeps(["--yes", "--handles", "bullmacro", "--env-file", envFile]);
    assert.match(result.stdout, /Warning: DESEARCH_API_BASE is not the default/);
    assert.match(result.stdout, /Warning: CHUTES_CHAT_COMPLETIONS_URL is not the default/);
    assert.match(result.stdout, /Desearch host: http:\/\/127\.0\.0\.1:9/);
  });

  it("rejects invalid or duplicate --handles before preflight", () => {
    const invalid = spawnAnalyzeWithFixtureDeps(
      ["--offline", "--yes", "--handles", "bullmacro,bad handle"],
    );
    assert.notEqual(invalid.status, 0);
    assert.match(
      invalid.stderr + invalid.stdout,
      /Invalid handle "bad handle": handle must contain only letters, numbers, and underscore/,
    );
    assert.doesNotMatch(invalid.stdout, /DESEARCH_MAX_REQUESTS_PER_RUN:/);

    const duplicate = spawnAnalyzeWithFixtureDeps(
      ["--offline", "--yes", "--handles", "bullmacro,BullMacro"],
    );
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr + duplicate.stdout, /Invalid handle "BullMacro": duplicate handle/);
  });
});

function withTestEnv(): NodeJS.ProcessEnv {
  return {
    DESEARCH_LIVE_ENABLED: "false",
    LLM_LIVE_ENABLED: "false",
  };
}
