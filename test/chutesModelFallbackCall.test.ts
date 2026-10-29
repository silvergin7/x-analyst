import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { LlmCallError } from "../src/analyze/chutesClient.js";
import { loadTokenizerRuntimeFromJsonPath } from "../src/analyze/tokenizerRuntime.js";
import {
  fallbackCandidates,
  requestChutesCompletionWithFallbacks,
  type PreparedChutesAttempt,
} from "../src/analyze/chutesModelFallbackCall.js";
import type { ChutesModelPlan } from "../src/analyze/chutesModelSelection.js";
import { DEFAULT_CHUTES_CHAT_COMPLETIONS_URL } from "../src/config/llmSettings.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";
import { testLlmRuntimeFields, withTestChutesModelEnv } from "./support/chutesTestModel.js";

function catalogModel(id: string) {
  return {
    id,
    root: "vendor/root",
    pricing: { promptUsdPerMillion: 0.5, completionUsdPerMillion: 2 },
    contextLength: 131_072,
    maxOutputLength: 65_536,
    supportedFeatures: ["structured_outputs", "reasoning"],
    confidentialCompute: true,
  };
}

function planWith(ids: readonly string[]): ChutesModelPlan {
  const candidates = ids.map((id, index) => ({
    model: catalogModel(id),
    rank: index + 1,
    worstCaseUsdPerHandle: 0.01,
  }));
  return {
    skippedCatalogEntries: 0,
    candidates,
    primary: candidates[0]!,
    fallbacks: candidates.slice(1, 3),
    priorValidReport: false,
  };
}

function prepared(modelId: string, env: NodeJS.ProcessEnv): PreparedChutesAttempt {
  const fields = testLlmRuntimeFields();
  const jsonPath = env.CHUTES_TOKENIZER_JSON_PATH!;
  return {
    config: {
      provider: "chutes",
      liveEnabled: true,
      apiKey: "test-key",
      chatCompletionsUrl: DEFAULT_CHUTES_CHAT_COMPLETIONS_URL,
      eligible: true,
      model: modelId,
      modelPricing: fields.modelPricing,
      contextLengthTokens: fields.contextLengthTokens,
    },
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 100,
    aliases: ["p1"],
    tokenizerJsonPath: jsonPath,
    tokenizerRuntime: loadTokenizerRuntimeFromJsonPath(jsonPath),
  };
}

describe("requestChutesCompletionWithFallbacks", () => {
  beforeEach(() => installByteQuarterMockTokenizer());
  afterEach(() => clearMockTokenizer());

  it("does not fall back when a Chutes call times out", async () => {
    const env = withTestChutesModelEnv({
      ANALYSIS_PROVIDER: "chutes",
      LLM_LIVE_ENABLED: "true",
      CHUTES_API_KEY: "test-key",
    });
    const plan = planWith(["A-TEE", "B-TEE"]);
    let posts = 0;
    let prepareCalls = 0;
    await assert.rejects(
      () =>
        requestChutesCompletionWithFallbacks({
          primaryConfig: prepared("A-TEE", env).config,
          plan,
          initialAttempt: prepared("A-TEE", env),
          prepareFallback: async () => {
            prepareCalls += 1;
            return prepared("B-TEE", env);
          },
          transport: {
            async post() {
              posts += 1;
              return new Promise(() => undefined);
            },
          },
          env,
          timeoutMs: 40,
        }),
      (err: unknown) =>
        err instanceof LlmCallError &&
        err.code === "timeout" &&
        err.message === "Chutes request timed out" &&
        err.llmModelAttempts?.length === 1 &&
        err.llmModelAttempts[0]?.modelId === "A-TEE" &&
        Number.isFinite(err.llmModelAttempts[0]?.durationMs),
    );
    assert.equal(posts, 1);
    assert.equal(prepareCalls, 0);
  });

  it("ends with the original 404 when every fallback is skipped", async () => {
    const env = withTestChutesModelEnv({
      ANALYSIS_PROVIDER: "chutes",
      LLM_LIVE_ENABLED: "true",
      CHUTES_API_KEY: "test-key",
    });
    const plan = planWith(["A-TEE", "B-TEE", "C-TEE"]);
    const posts: string[] = [];
    let refreshCalls = 0;
    let prepareCalls = 0;
    await assert.rejects(
      () =>
        requestChutesCompletionWithFallbacks({
          primaryConfig: prepared("A-TEE", env).config,
          plan,
          initialAttempt: prepared("A-TEE", env),
          prepareFallback: async () => {
            prepareCalls += 1;
            return null;
          },
          refreshPlan: async () => {
            refreshCalls += 1;
            return planWith(["B-TEE", "C-TEE"]);
          },
          transport: {
            async post(_url, request) {
              posts.push(JSON.parse(request.body).model as string);
              return { status: 404, bodyText: "missing" };
            },
          },
          env,
        }),
      (err: unknown) => {
        assert.ok(err instanceof LlmCallError);
        assert.equal(err.httpStatus, 404);
        assert.deepEqual(
          err.llmModelAttempts?.map((item) => ({ modelId: item.modelId, kind: item.kind })),
          [
            { modelId: "A-TEE", kind: "sent" },
            { modelId: "B-TEE", kind: "skipped" },
            { modelId: "C-TEE", kind: "skipped" },
          ],
        );
        assert.equal(Number.isFinite(err.llmModelAttempts?.[0]?.durationMs), true);
        assert.equal(err.llmModelAttempts?.[1]?.durationMs, undefined);
        assert.equal(err.llmModelAttempts?.[2]?.durationMs, undefined);
        return true;
      },
    );
    assert.deepEqual(posts, ["A-TEE"]);
    assert.equal(refreshCalls, 1);
    assert.equal(prepareCalls, 2);
  });

  it("ends the same way when refresh returns only models that are then skipped", async () => {
    const env = withTestChutesModelEnv({
      ANALYSIS_PROVIDER: "chutes",
      LLM_LIVE_ENABLED: "true",
      CHUTES_API_KEY: "test-key",
    });
    const plan = planWith(["A-TEE", "B-TEE", "C-TEE"]);
    const posts: string[] = [];
    let refreshCalls = 0;
    await assert.rejects(
      () =>
        requestChutesCompletionWithFallbacks({
          primaryConfig: prepared("A-TEE", env).config,
          plan,
          initialAttempt: prepared("A-TEE", env),
          prepareFallback: async () => null,
          refreshPlan: async (exclude) => {
            refreshCalls += 1;
            assert.deepEqual(exclude, ["A-TEE"]);
            return planWith(["B-TEE", "C-TEE"]);
          },
          transport: {
            async post(_url, request) {
              posts.push(JSON.parse(request.body).model as string);
              return { status: 404, bodyText: "missing" };
            },
          },
          env,
        }),
      (err: unknown) => err instanceof LlmCallError,
    );
    assert.deepEqual(posts, ["A-TEE"]);
    assert.equal(refreshCalls, 1);
  });

  it("records B skipped and succeeds on C", async () => {
    const env = withTestChutesModelEnv({
      ANALYSIS_PROVIDER: "chutes",
      LLM_LIVE_ENABLED: "true",
      CHUTES_API_KEY: "test-key",
    });
    const plan = planWith(["A-TEE", "B-TEE", "C-TEE"]);
    const posts: string[] = [];
    const result = await requestChutesCompletionWithFallbacks({
      primaryConfig: prepared("A-TEE", env).config,
      plan,
      initialAttempt: prepared("A-TEE", env),
      prepareFallback: async (model) =>
        model.id === "B-TEE" ? null : prepared(model.id, env),
      refreshPlan: async () => planWith(["B-TEE", "C-TEE"]),
      transport: {
        async post(_url, request) {
          const model = JSON.parse(request.body).model as string;
          posts.push(model);
          if (model === "A-TEE") {
            return { status: 404, bodyText: "missing" };
          }
          return {
            status: 200,
            bodyText: JSON.stringify({
              choices: [{ finish_reason: "stop", message: { content: "{}" } }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
          };
        },
      },
      env,
    });
    assert.deepEqual(posts, ["A-TEE", "C-TEE"]);
    assert.equal(result.modelId, "C-TEE");
    assert.deepEqual(
      result.modelAttempts.map((item) => ({ modelId: item.modelId, kind: item.kind })),
      [
        { modelId: "A-TEE", kind: "sent" },
        { modelId: "B-TEE", kind: "skipped" },
        { modelId: "C-TEE", kind: "sent" },
      ],
    );
    assert.equal(Number.isFinite(result.modelAttempts[0]?.durationMs), true);
    assert.equal(result.modelAttempts[1]?.durationMs, undefined);
    assert.equal(Number.isFinite(result.modelAttempts[2]?.durationMs), true);
  });

  it("mutation: fallbackCandidates must exclude skipped models", () => {
    const plan = planWith(["A-TEE", "B-TEE"]);
    const excluded = new Set(["A-TEE", "B-TEE"]);
    assert.deepEqual(fallbackCandidates(plan, excluded), []);
    const broken = fallbackCandidates(plan, new Set(["A-TEE"]));
    assert.equal(broken.length, 1);
    assert.equal(broken[0]?.model.id, "B-TEE");
  });
});
