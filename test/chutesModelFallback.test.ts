import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach, afterEach } from "node:test";
import { planAnalysisInput } from "../src/analyze/analysisInput.js";
import { LlmOutlookAnalyzer } from "../src/analyze/llmOutlookAnalyzer.js";
import type { ChutesTransport } from "../src/analyze/chutesClient.js";
import type { LlmRuntimeConfig } from "../src/config/llmSettings.js";
import { DEFAULT_CHUTES_CHAT_COMPLETIONS_URL } from "../src/config/llmSettings.js";
import { aliasModel, classifiedOutlook } from "./classifiedOutlook.js";
import { TEST_CHUTES_MODEL_ID, testLlmRuntimeFields, withTestChutesModelEnv } from "./support/chutesTestModel.js";
import { testChutesModelPlan } from "./support/testChutesModelPlan.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";
import type { Post } from "../src/types.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const hfFixtureDir = path.join(repoRoot, "test/fixtures/hf");
const question = { text: "What is each analyst's current market outlook?" };
const complete = { retrievalComplete: true as const };

function liveConfig(): LlmRuntimeConfig {
  return {
    provider: "chutes",
    liveEnabled: true,
    apiKey: "test-key",
    chatCompletionsUrl: DEFAULT_CHUTES_CHAT_COMPLETIONS_URL,
    eligible: true,
    ...testLlmRuntimeFields(),
  };
}

function post(overrides: Partial<Post> & Pick<Post, "id" | "kind" | "text">): Post {
  return {
    authorHandle: "analyst",
    timestamp: "2026-09-20T00:00:00.000Z",
    url: `https://fixture.x-analyst.local/posts/analyst/${overrides.id}`,
    ...overrides,
  };
}

describe("Chutes model fallback", () => {
  beforeEach(() => installByteQuarterMockTokenizer());
  afterEach(() => clearMockTokenizer());

  it("skips a fallback that cannot fit and succeeds on the next model", async () => {
    const posts = [post({ id: "o1", kind: "original", text: "Constructive tone." })];
    const cheapFallback = {
      model: {
        id: "vendor/cheap-TEE",
        root: "vendor/cheap",
        pricing: { promptUsdPerMillion: 0.5, completionUsdPerMillion: 2 },
        contextLength: 512,
        maxOutputLength: 256,
        supportedFeatures: ["structured_outputs", "reasoning"],
        confidentialCompute: true,
      },
      rank: 2,
      worstCaseUsdPerHandle: 0.01,
    };
    const wideFallback = {
      model: {
        id: "vendor/wide-TEE",
        root: "vendor/cheap",
        pricing: { promptUsdPerMillion: 0.5, completionUsdPerMillion: 2 },
        contextLength: 131_072,
        maxOutputLength: 65_536,
        supportedFeatures: ["structured_outputs", "reasoning"],
        confidentialCompute: true,
      },
      rank: 3,
      worstCaseUsdPerHandle: 0.01,
    };
    const plan = testChutesModelPlan({
      candidates: [testChutesModelPlan().primary, cheapFallback, wideFallback],
      fallbacks: [cheapFallback, wideFallback],
    });
    const modelsSent: string[] = [];
    const payload = classifiedOutlook({
      outlook: "cautious",
      explanation: "Thin evidence.",
      posts: [{ postId: "o1", relevant: true, asset_class: "macro", stance: "neutral" }],
    });
    const content = JSON.stringify(
      aliasModel(planAnalysisInput(posts, "analyst").sent, payload),
    );
    const transport: ChutesTransport = {
      async post(_url, request) {
        const body = JSON.parse(request.body) as { model: string };
        modelsSent.push(body.model);
        if (body.model === TEST_CHUTES_MODEL_ID) {
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
    const env = withTestChutesModelEnv({
      ANALYSIS_PROVIDER: "chutes",
      LLM_LIVE_ENABLED: "true",
      CHUTES_API_KEY: "test-key",
    });
    const { createDirectoryHfModelInfoTransport, createFileTokenizerDownloadTransport } =
      await import("./support/chutesFixtureTransports.js");
    const analyzer = new LlmOutlookAnalyzer(liveConfig(), transport, undefined, "fixtures", {
      runEnv: env,
      chutesModelPlan: plan,
      hfModelTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
      hfDownloadTransport: createFileTokenizerDownloadTransport(
        path.join(repoRoot, "test/fixtures/tokenizer.json"),
      ),
    });
    const report = await analyzer.analyzePerson("analyst", posts, question, complete);
    assert.equal(modelsSent.length, 2);
    assert.deepEqual(modelsSent, [TEST_CHUTES_MODEL_ID, "vendor/wide-TEE"]);
    assert.equal(report.llmModel, "vendor/wide-TEE");
    assert.ok(report.llmModelsTried?.includes(TEST_CHUTES_MODEL_ID));
    assert.deepEqual(
      report.llmModelAttempts?.filter((item) => item.kind === "skipped").map((item) => item.modelId),
      ["vendor/cheap-TEE"],
    );
  });

  it("keeps the successful fallback model for later handles", async () => {
    const cheapFallback = {
      model: {
        id: "vendor/wide-TEE",
        root: "vendor/cheap",
        pricing: { promptUsdPerMillion: 0.5, completionUsdPerMillion: 2 },
        contextLength: 131_072,
        maxOutputLength: 65_536,
        supportedFeatures: ["structured_outputs", "reasoning"],
        confidentialCompute: true,
      },
      rank: 2,
      worstCaseUsdPerHandle: 0.01,
    };
    const plan = testChutesModelPlan({
      candidates: [testChutesModelPlan().primary, cheapFallback],
      fallbacks: [cheapFallback],
    });
    const planRef = { current: plan };
    const activeRunBinding: { current?: import("../src/analyze/chutesRuntimeModel.js").ChutesRunModelBinding } =
      {};
    const env = withTestChutesModelEnv({
      ANALYSIS_PROVIDER: "chutes",
      LLM_LIVE_ENABLED: "true",
      CHUTES_API_KEY: "test-key",
    });
    activeRunBinding.current = {
      catalogModel: plan.primary.model,
      runtimeConfig: liveConfig(),
      tokenizerJsonPath: env.CHUTES_TOKENIZER_JSON_PATH!,
      tokenizerPin: {
        root: env.CHUTES_TOKENIZER_ROOT!,
        commit: env.CHUTES_TOKENIZER_COMMIT!,
        sha256: env.CHUTES_TOKENIZER_SHA256!,
      },
      tokenizerRuntime: (await import("../src/analyze/tokenizerRuntime.js")).loadTokenizerRuntimeFromJsonPath(
        env.CHUTES_TOKENIZER_JSON_PATH!,
      ),
    };
    const modelsByHandle: string[][] = [[], []];
    let handleIndex = 0;
    const posts = [post({ id: "o1", kind: "original", text: "Constructive tone." })];
    const payload = classifiedOutlook({
      outlook: "cautious",
      explanation: "Thin evidence.",
      posts: [{ postId: "o1", relevant: true, asset_class: "macro", stance: "neutral" }],
    });
    const content = JSON.stringify(
      aliasModel(planAnalysisInput(posts, "analyst").sent, payload),
    );
    const transport: ChutesTransport = {
      async post(_url, request) {
        const body = JSON.parse(request.body) as { model: string };
        modelsByHandle[handleIndex]!.push(body.model);
        if (body.model === TEST_CHUTES_MODEL_ID) {
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
    const { createDirectoryHfModelInfoTransport, createFileTokenizerDownloadTransport } =
      await import("./support/chutesFixtureTransports.js");
    const analyzer = new LlmOutlookAnalyzer(liveConfig(), transport, undefined, "fixtures", {
      runEnv: env,
      chutesModelPlan: plan,
      chutesModelPlanRef: planRef,
      activeRunBinding,
      hfModelTransport: createDirectoryHfModelInfoTransport(hfFixtureDir),
      hfDownloadTransport: createFileTokenizerDownloadTransport(
        path.join(repoRoot, "test/fixtures/tokenizer.json"),
      ),
    });
    handleIndex = 0;
    const first = await analyzer.analyzePerson("analyst", posts, question, complete);
    handleIndex = 1;
    const second = await analyzer.analyzePerson("analyst", posts, question, complete);
    assert.deepEqual(modelsByHandle[0], [TEST_CHUTES_MODEL_ID, "vendor/wide-TEE"]);
    assert.deepEqual(modelsByHandle[1], ["vendor/wide-TEE"]);
    assert.equal(first.llmModel, "vendor/wide-TEE");
    assert.equal(second.llmModel, "vendor/wide-TEE");
    assert.equal(activeRunBinding.current?.runtimeConfig.model, "vendor/wide-TEE");
    assert.equal(activeRunBinding.current?.runtimeConfig.modelPricing.promptUsdPerMillion, 0.5);
    assert.equal(
      activeRunBinding.current?.tokenizerJsonPath,
      env.CHUTES_TOKENIZER_JSON_PATH,
    );
  });
});
