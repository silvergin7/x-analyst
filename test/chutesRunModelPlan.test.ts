import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildChutesModelPlanForRun } from "../src/analyze/buildChutesModelPlanForRun.js";
import { planAnalysisInput } from "../src/analyze/analysisInput.js";
import { LlmOutlookAnalyzer } from "../src/analyze/llmOutlookAnalyzer.js";
import { buildAnalyzePreflightLines } from "../src/analyzePreflight.js";
import { llmRuntimeConfigForChutesPlan } from "../src/config/llmSettings.js";
import { formatBudgetEstimate } from "../src/format/llmFixtureReport.js";
import { runReport } from "../src/runReport.js";
import type { BudgetEstimate } from "../src/types.js";
import type { ChutesTransport } from "../src/analyze/chutesClient.js";
import { FIXTURE_POSTS_BY_HANDLE } from "../src/fixtures/samplePosts.js";
import type { Post } from "../src/types.js";
import { aliasModel, classifiedOutlook } from "./classifiedOutlook.js";
import {
  createDirectoryHfModelInfoTransport,
  createFileCatalogTransport,
  createFileTokenizerDownloadTransport,
} from "./support/chutesFixtureTransports.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";
import { withTestChutesModelEnv } from "./support/chutesTestModel.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const testSliceDir = mkdtempSync(path.join(tmpdir(), "x-analyst-chutes-plan-slices-"));
const threeModelCatalog = path.join(
  repoRoot,
  "test/fixtures/chutesModelsCatalogThreeEligible.json",
);
const catalogFixturePath = path.join(repoRoot, "test/fixtures/chutesModelsCatalog.json");
const hfFixtureDir = path.join(repoRoot, "test/fixtures/hf");
const tokenizerFixture = path.join(repoRoot, "test/fixtures/tokenizer.json");
const question = { text: "What is each analyst's current market outlook?" };
const fixturePosts = FIXTURE_POSTS_BY_HANDLE.bullmacro;

function modelFor(posts: readonly Post[], payload: ReturnType<typeof classifiedOutlook>) {
  const handle = posts[0]?.authorHandle ?? "bullmacro";
  return aliasModel(planAnalysisInput([...posts], handle).sent, payload);
}

function emptyModelStatePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "model-state-empty-"));
  const statePath = path.join(dir, "state.json");
  writeFileSync(statePath, "{}\n");
  return statePath;
}

describe("Chutes run model plan", () => {
  beforeEach(() => installByteQuarterMockTokenizer());
  afterEach(() => clearMockTokenizer());

  it("buildChutesModelPlanForRun keeps top 10 ranks and lists two fallbacks", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "tokenizer-cache-plan-"));
    const env = {
      ...withTestChutesModelEnv({}),
      X_ANALYST_TOKENIZER_CACHE_DIR: cacheDir,
      X_ANALYST_MODEL_STATE_PATH: emptyModelStatePath(),
    };
    const plan = await buildChutesModelPlanForRun({
      env,
      handles: ["bullmacro"],
      question: question.text,
      referenceDate: "2026-10-10",
      replay: false,
      catalogTransport: createFileCatalogTransport(threeModelCatalog),
      hfTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
      hfDownloadTransport: createFileTokenizerDownloadTransport(tokenizerFixture),
    });
    assert.equal(plan.candidates.length, 3);
    assert.equal(plan.primary.model.id, "rank1/primary-TEE");
    assert.equal(plan.primary.rank, 1);
    assert.equal(plan.fallbacks.length, 2);
    assert.deepEqual(
      plan.fallbacks.map((item) => item.model.id),
      ["rank2/fallback-TEE", "rank3/third-TEE"],
    );
    const lines = buildAnalyzePreflightLines({
      handles: ["bullmacro"],
      question: question.text,
      referenceDate: "2026-10-10",
      replay: false,
      offline: false,
      env,
      chutesModelPlan: plan,
    });
    assert.match(lines.join("\n"), /Chutes fallbacks: rank2\/fallback-TEE, rank3\/third-TEE/);
  });

  it("shows sticky model at its real rank", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "tokenizer-cache-sticky-"));
    const stateDir = mkdtempSync(path.join(tmpdir(), "model-state-"));
    const statePath = path.join(stateDir, "state.json");
    writeFileSync(
      statePath,
      `${JSON.stringify({ lastValidModel: "rank3/third-TEE", validModels: ["rank3/third-TEE"] }, null, 2)}\n`,
    );
    const env = {
      ...withTestChutesModelEnv({}),
      X_ANALYST_TOKENIZER_CACHE_DIR: cacheDir,
      X_ANALYST_MODEL_STATE_PATH: statePath,
    };
    const plan = await buildChutesModelPlanForRun({
      env,
      handles: ["bullmacro"],
      question: question.text,
      referenceDate: "2026-10-10",
      replay: false,
      catalogTransport: createFileCatalogTransport(threeModelCatalog),
      hfTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
      hfDownloadTransport: createFileTokenizerDownloadTransport(tokenizerFixture),
    });
    assert.equal(plan.primary.model.id, "rank3/third-TEE");
    assert.equal(plan.primary.rank, 1);
    assert.ok(plan.candidates.some((item) => item.model.id === "rank1/primary-TEE" && item.rank > 1));
  });

  it("runReport falls back on 404 using the real plan builder", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "tokenizer-cache-run-"));
    const env = withTestChutesModelEnv({
      POSTS_PROVIDER: "mock",
      ANALYSIS_PROVIDER: "chutes",
      LLM_LIVE_ENABLED: "true",
      CHUTES_API_KEY: "test-key",
      X_ANALYST_TOKENIZER_CACHE_DIR: cacheDir,
      X_ANALYST_SLICE_DIR: testSliceDir,
      X_ANALYST_MODEL_STATE_PATH: emptyModelStatePath(),
    });
    delete env.LLM_MODEL;
    delete env.CHUTES_MODEL_PROMPT_USD_PER_MILLION;
    delete env.CHUTES_MODEL_COMPLETION_USD_PER_MILLION;
    delete env.CHUTES_MODEL_CONTEXT_LENGTH;
    const plan = await buildChutesModelPlanForRun({
      env,
      handles: ["bullmacro"],
      question: question.text,
      referenceDate: "2026-10-10",
      replay: false,
      catalogTransport: createFileCatalogTransport(threeModelCatalog),
      hfTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
      hfDownloadTransport: createFileTokenizerDownloadTransport(tokenizerFixture),
    });
    const payload = classifiedOutlook({
      outlook: "bullish",
      explanation: "Constructive fixture tone on liquidity and earnings.",
      posts: [
        { postId: "b1", relevant: true, asset_class: "macro", stance: "bullish" },
        { postId: "b2", relevant: true, asset_class: "equities", stance: "bullish" },
      ],
    });
    const content = JSON.stringify(modelFor(fixturePosts, payload));
    const modelsSent: string[] = [];
    const chutesTransport: ChutesTransport = {
      async post(_url, request) {
        const body = JSON.parse(request.body) as { model: string };
        modelsSent.push(body.model);
        if (body.model === plan.primary.model.id) {
          return { status: 404, bodyText: "missing" };
        }
        return {
          status: 200,
          bodyText: JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        };
      },
    };
    const result = await runReport(["bullmacro"], question, {
      referenceDate: "2026-10-10",
      env,
      chutesModelPlan: plan,
      ownerForcedModelId: undefined,
      catalogTransport: createFileCatalogTransport(threeModelCatalog),
      hfTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
      hfDownloadTransport: createFileTokenizerDownloadTransport(tokenizerFixture),
      chutesTransport,
    });
    assert.deepEqual(modelsSent, [plan.primary.model.id, "rank2/fallback-TEE"]);
    assert.equal(result.reports[0]?.llmModel, "rank2/fallback-TEE");
    assert.deepEqual(result.reports[0]?.llmModelsTried, [
      plan.primary.model.id,
      "rank2/fallback-TEE",
    ]);
  });

  it("owner LLM_MODEL override blocks refresh and fallback on 404", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "tokenizer-cache-owner-"));
    const env = {
      ...withTestChutesModelEnv({
        POSTS_PROVIDER: "mock",
        ANALYSIS_PROVIDER: "chutes",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "test-key",
        X_ANALYST_TOKENIZER_CACHE_DIR: cacheDir,
        X_ANALYST_SLICE_DIR: testSliceDir,
        X_ANALYST_MODEL_STATE_PATH: emptyModelStatePath(),
      }),
      LLM_MODEL: "rank1/primary-TEE",
    };
    const ownerForcedModelId = "rank1/primary-TEE";
    const plan = await buildChutesModelPlanForRun({
      env,
      handles: ["bullmacro"],
      question: question.text,
      referenceDate: "2026-10-10",
      replay: false,
      catalogTransport: createFileCatalogTransport(threeModelCatalog),
      hfTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
      hfDownloadTransport: createFileTokenizerDownloadTransport(tokenizerFixture),
      ownerForcedModelId,
    });
    assert.equal(plan.fallbacks.length, 0);
    const modelsSent: string[] = [];
    const chutesTransport: ChutesTransport = {
      async post(_url, request) {
        const body = JSON.parse(request.body) as { model: string };
        modelsSent.push(body.model);
        return { status: 404, bodyText: "missing" };
      },
    };
    const result = await runReport(["bullmacro"], question, {
      referenceDate: "2026-10-10",
      env,
      chutesModelPlan: plan,
      ownerForcedModelId,
      catalogTransport: createFileCatalogTransport(threeModelCatalog),
      hfTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
      hfDownloadTransport: createFileTokenizerDownloadTransport(tokenizerFixture),
      chutesTransport,
    });
    assert.deepEqual(modelsSent, [plan.primary.model.id]);
    assert.equal(result.reports.length, 0);
    assert.equal(result.handleFailures.length, 1);
    assert.match(result.handleFailures[0]!.message, /404|Chutes returned HTTP/i);
    assert.equal(env.LLM_MODEL, "rank1/primary-TEE");
  });

  it("prices the printed Chutes estimate from the selected catalog model", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "tokenizer-cache-price-"));
    const env = withTestChutesModelEnv({
      POSTS_PROVIDER: "mock",
      ANALYSIS_PROVIDER: "chutes",
      LLM_LIVE_ENABLED: "true",
      CHUTES_API_KEY: "test-key",
      X_ANALYST_TOKENIZER_CACHE_DIR: cacheDir,
      X_ANALYST_SLICE_DIR: testSliceDir,
      X_ANALYST_MODEL_STATE_PATH: emptyModelStatePath(),
    });
    delete env.LLM_MODEL;
    delete env.CHUTES_MODEL_PROMPT_USD_PER_MILLION;
    delete env.CHUTES_MODEL_COMPLETION_USD_PER_MILLION;
    delete env.CHUTES_MODEL_CONTEXT_LENGTH;
    const plan = await buildChutesModelPlanForRun({
      env,
      handles: ["bullmacro"],
      question: question.text,
      referenceDate: "2026-10-10",
      replay: false,
      catalogTransport: createFileCatalogTransport(catalogFixturePath),
      hfTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
      hfDownloadTransport: createFileTokenizerDownloadTransport(tokenizerFixture),
    });
    const pricing = plan.primary.model.pricing;
    const payload = classifiedOutlook({
      outlook: "bullish",
      explanation: "Constructive fixture tone on liquidity and earnings.",
      posts: [
        { postId: "b1", relevant: true, asset_class: "macro", stance: "bullish" },
        { postId: "b2", relevant: true, asset_class: "equities", stance: "bullish" },
      ],
    });
    const content = JSON.stringify(modelFor(fixturePosts, payload));
    const calls: { body: string }[] = [];
    let estimate: BudgetEstimate | undefined;
    const printed: string[] = [];
    const chutesTransport: ChutesTransport = {
      async post(_url, request) {
        calls.push({ body: request.body });
        return {
          status: 200,
          bodyText: JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        };
      },
    };
    const result = await runReport(["bullmacro"], question, {
      referenceDate: "2026-10-10",
      env,
      chutesModelPlan: plan,
      chutesTransport,
      onEstimate: (value) => {
        estimate = value;
        printed.push(formatBudgetEstimate(value));
      },
    });
    assert.equal(result.reports.length, 1);
    assert.equal(calls.length, 1);
    assert.ok(estimate);
    const body = JSON.parse(calls[0]!.body) as { max_tokens: number };
    const priced = estimate as BudgetEstimate;
    const expected =
      (priced.inputTokensUpper * pricing.promptUsdPerMillion) / 1_000_000 +
      (body.max_tokens * pricing.completionUsdPerMillion) / 1_000_000;
    assert.equal(priced.estimatedUsd, expected);
    assert.ok(priced.estimatedUsd > 0);
    assert.match(printed[0] ?? "", /Pessimistic estimate \$/);
    assert.ok((printed[0] ?? "").includes(priced.estimatedUsd.toFixed(6)));
  });

  it("does not write selected model pricing into env during analysis", async () => {
    const env = withTestChutesModelEnv({
      LLM_MODEL: "rank1/primary-TEE",
      CHUTES_MODEL_PROMPT_USD_PER_MILLION: "0.104",
    });
    const before = { ...env };
    const ownerForcedModelId = "rank1/primary-TEE";
    const plan = await buildChutesModelPlanForRun({
      env,
      handles: ["bullmacro"],
      question: question.text,
      referenceDate: "2026-10-10",
      replay: false,
      catalogTransport: createFileCatalogTransport(threeModelCatalog),
      hfTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
      hfDownloadTransport: createFileTokenizerDownloadTransport(tokenizerFixture),
      ownerForcedModelId,
    });
    const llm = llmRuntimeConfigForChutesPlan(env, plan.primary.model);
    assert.equal(llm.model, plan.primary.model.id);
    assert.equal(env.LLM_MODEL, before.LLM_MODEL);
    assert.equal(env.CHUTES_MODEL_PROMPT_USD_PER_MILLION, before.CHUTES_MODEL_PROMPT_USD_PER_MILLION);
    const analyzer = new LlmOutlookAnalyzer(
      llm,
      { async post() { return { status: 200, bodyText: "{}" }; } },
      "2026-10-10",
      "fixtures",
      { runEnv: env, chutesModelPlan: plan },
    );
    assert.equal(analyzer, analyzer);
  });
});
