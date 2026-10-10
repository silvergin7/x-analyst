import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChutesTransport } from "../src/analyze/chutesClient.js";
import type { DesearchTransport } from "../src/fetch/desearch/desearchTransport.js";
import { createFetchSliceCache } from "../src/runtime/fetchCache.js";
import { ReportConfigError, ReportRunError, runReport } from "../src/runReport.js";

const question = { text: "What is each analyst's current market outlook?" };
const MODEL = "Qwen/Qwen3-32B-TEE";

function desearchEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    POSTS_PROVIDER: "desearch",
    DESEARCH_LIVE_ENABLED: "true",
    DESEARCH_API_KEY: "unit-test-only-not-a-secret",
    DESEARCH_MAX_REQUESTS_PER_RUN: "1",
    ANALYSIS_PROVIDER: "chutes",
    LLM_LIVE_ENABLED: "true",
    CHUTES_API_KEY: "unit-test-only-not-a-secret",
    LLM_MODEL: MODEL,
    ...extra,
  };
}

function tweet(id: string, quote: boolean, username = "bullmacro") {
  return {
    id,
    text: quote ? "Quoted headline that must stay out of the prompt" : "Growth remains constructive.",
    created_at: "2026-09-20T14:00:00.000Z",
    url: `https://x.com/example/status/${id}`,
    is_retweet: false,
    is_quote_tweet: quote,
    user: { username },
  };
}

function desearchTransport(tweets: unknown[], billing?: { costUsd?: number; usageCount?: number }) {
  const calls: unknown[] = [];
  const transport: DesearchTransport = {
    async execute(request) {
      calls.push(request);
      return {
        status: 200,
        body: { tweets },
        ...(billing ? { billing } : {}),
      };
    },
  };
  return { calls, transport };
}

function chutesTransport(content: unknown, extra?: { finish_reason?: string; usage?: Record<string, number> }) {
  const calls: { body: string }[] = [];
  const transport: ChutesTransport = {
    async post(_url, request) {
      calls.push({ body: request.body });
      return {
        status: 200,
        bodyText: JSON.stringify({
          choices: [
            {
              finish_reason: extra?.finish_reason ?? "stop",
              message: {
                content: JSON.stringify(content),
                refusal: null,
              },
            },
          ],
          usage: extra?.usage ?? {
            prompt_tokens: 20,
            completion_tokens: 8,
            total_tokens: 28,
          },
        }),
      };
    },
  };
  return { calls, transport };
}

function promptText(body: string): string {
  const parsed = JSON.parse(body) as { messages: { content: string }[] };
  return parsed.messages.map((message) => message.content).join("\n");
}

describe("runReport live gates", () => {
  it("stays on fixtures and mock rules when providers are unset", async () => {
    const posts = desearchTransport([tweet("live-1", false)]);
    const model = chutesTransport({
      outlook: "bullish",
      explanation: "Should not be used.",
      evidencePostIds: ["live-1"],
    });
    const result = await runReport(["bullmacro"], question, {
      referenceDate: "2026-11-02",
      env: {},
      cache: createFetchSliceCache(),
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 0);
    assert.equal(model.calls.length, 0);
    assert.equal(result.postsSource, "fixtures");
    assert.equal(result.analysisSource, "mock-rules");
    assert.equal(result.referenceDate, "2026-11-02");
    assert.equal(result.reused, false);
    assert.equal(result.reports[0]?.analysisSource, "mock");
  });

  it("stops before a request when a selected live provider cannot run", async () => {
    const posts = desearchTransport([tweet("live-1", false)]);
    const model = chutesTransport({
      outlook: "bullish",
      explanation: "Should not be used.",
      evidencePostIds: ["live-1"],
    });
    const options = {
      referenceDate: "2026-11-02",
      cache: createFetchSliceCache(),
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    };
    await assert.rejects(
      () =>
        runReport(["bullmacro"], question, {
          ...options,
          env: { POSTS_PROVIDER: "desearch", ANALYSIS_PROVIDER: "mock" },
        }),
      (err: unknown) => err instanceof ReportConfigError && /No request was sent/.test(err.message),
    );
    await assert.rejects(
      () =>
        runReport(["bullmacro"], question, {
          ...options,
          env: {
            POSTS_PROVIDER: "desearch",
            DESEARCH_LIVE_ENABLED: "true",
            DESEARCH_API_KEY: "unit-test-only-not-a-secret",
            ANALYSIS_PROVIDER: "chutes",
            LLM_LIVE_ENABLED: "true",
          },
        }),
      /No request was sent/,
    );
    await assert.rejects(
      () =>
        runReport(["bullmacro"], { text: "q".repeat(501) }, {
          ...options,
          env: desearchEnv(),
        }),
      /No request was sent/,
    );
    await assert.rejects(
      () =>
        runReport(["bullmacro"], question, {
          ...options,
          referenceDate: "2026-02-31",
          env: desearchEnv(),
        }),
      /No request was sent/,
    );
    assert.equal(posts.calls.length, 0);
    assert.equal(model.calls.length, 0);
  });

  it("sends retrieved posts to Chutes with the invocation date and no fixture wording", async () => {
    const posts = desearchTransport(
      [tweet("quote-1", true), tweet("live-1", false)],
      { usageCount: 10 },
    );
    const model = chutesTransport({
      outlook: "bullish",
      explanation: "The supplied original says growth remains constructive.",
      evidencePostIds: ["live-1"],
    });
    const result = await runReport(["bullmacro"], question, {
      referenceDate: "2026-11-02",
      env: desearchEnv(),
      cache: createFetchSliceCache(),
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 1);
    assert.equal(model.calls.length, 1);
    const prompt = promptText(model.calls[0]!.body);
    assert.match(prompt, /Analysis reference date: 2026-11-02/);
    assert.match(prompt, /Growth remains constructive/);
    assert.doesNotMatch(prompt, /synthetic fixture/);
    assert.doesNotMatch(prompt, /not current real-world research/);
    assert.doesNotMatch(prompt, /Quoted headline/);
    assert.equal(result.postsSource, "desearch");
    assert.equal(result.analysisSource, "chutes");
    assert.equal(result.reused, false);
    assert.deepEqual(result.billing, [{ usageCount: 10 }]);
    assert.equal(Object.hasOwn(result.billing[0] ?? {}, "costUsd"), false);
    assert.equal(result.reports[0]?.analysisSource, "llm");
    assert.equal(result.reports[0]?.evidence[0]?.url, "https://x.com/example/status/live-1");
    assert.ok(
      result.reports[0]?.analysisInput?.some(
        (record) =>
          record.postId === "quote-1" && record.reason === "quote_without_analyst_commentary",
      ),
    );
  });

  it("returns local unclear and skips Chutes when only an uncommented quote was retrieved", async () => {
    const posts = desearchTransport([tweet("quote-1", true)]);
    const model = chutesTransport({
      outlook: "bullish",
      explanation: "Should not be used.",
      evidencePostIds: ["quote-1"],
    });
    const result = await runReport(["bullmacro"], question, {
      referenceDate: "2026-11-02",
      env: desearchEnv(),
      cache: createFetchSliceCache(),
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 1);
    assert.equal(model.calls.length, 0);
    assert.equal(result.reports[0]?.outlook, "unclear");
    assert.equal(result.reports[0]?.modelInvoked, false);
  });

  it("reuses the same slice until an explicit fresh fetch, and misses when the request cap changes", async () => {
    const times = ["2026-11-02T12:00:00.000Z", "2026-11-02T13:00:00.000Z", "2026-11-02T14:00:00.000Z"];
    let tick = 0;
    const cache = createFetchSliceCache(
      () => new Date(times[Math.min(tick++, times.length - 1)]!),
    );
    const posts = desearchTransport([tweet("live-1", false)], { usageCount: 1 });
    const model = chutesTransport({
      outlook: "bullish",
      explanation: "The supplied original says growth remains constructive.",
      evidencePostIds: ["live-1"],
    });
    const first = await runReport(["bullmacro"], question, {
      referenceDate: "2026-11-02",
      env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "1" }),
      cache,
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    const second = await runReport(["bullmacro"], question, {
      referenceDate: "2026-11-02",
      env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "1" }),
      cache,
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 1);
    assert.equal(model.calls.length, 2);
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.fetchedAt, first.fetchedAt);
    assert.equal(first.fetchedAt, "2026-11-02T12:00:00.000Z");

    const fresh = await runReport(["bullmacro"], question, {
      referenceDate: "2026-11-02",
      fresh: true,
      env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "1" }),
      cache,
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 2);
    assert.equal(fresh.reused, false);
    assert.equal(fresh.fetchedAt, "2026-11-02T13:00:00.000Z");

    await runReport(["bullmacro"], question, {
      referenceDate: "2026-11-02",
      env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "2" }),
      cache,
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 3);

    const replaced = await runReport(["bullmacro"], question, {
      referenceDate: "2026-11-02",
      env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "1" }),
      cache,
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 4);
    assert.equal(replaced.reused, false);
  });

  it("keeps provider usage when Chutes refuses after a fetch", async () => {
    const posts = desearchTransport([tweet("live-1", false)]);
    const model = chutesTransport(
      { outlook: "bullish", explanation: "no", evidencePostIds: ["live-1"] },
      { finish_reason: "refusal", usage: { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 } },
    );
    await assert.rejects(
      () =>
        runReport(["bullmacro"], question, {
          referenceDate: "2026-11-02",
          env: desearchEnv(),
          cache: createFetchSliceCache(),
          desearchTransport: posts.transport,
          chutesTransport: model.transport,
        }),
      (err: unknown) =>
        err instanceof ReportRunError &&
        err.details.providerUsages[0]?.promptTokens === 9 &&
        err.details.sliceStored === true &&
        err.details.reused === false,
    );
    assert.equal(posts.calls.length, 1);
    assert.equal(model.calls.length, 1);
  });

  it("uses synthetic fixture wording only when the posts are fixtures", async () => {
    const posts = desearchTransport([tweet("live-1", false)]);
    const model = chutesTransport({
      outlook: "bullish",
      explanation: "The fixture originals are constructive.",
      evidencePostIds: ["b1"],
    });
    await runReport(["bullmacro"], question, {
      referenceDate: "2026-11-02",
      env: {
        ANALYSIS_PROVIDER: "chutes",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "unit-test-only-not-a-secret",
        LLM_MODEL: MODEL,
      },
      cache: createFetchSliceCache(),
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 0);
    assert.equal(model.calls.length, 1);
    const prompt = promptText(model.calls[0]!.body);
    assert.match(prompt, /synthetic fixture test/);
    assert.match(prompt, /Analysis reference date: 2026-11-02/);
  });

  it("keeps earlier billing and both model usages when a later analyst call fails", async () => {
    const calls: unknown[] = [];
    const posts = {
      calls,
      transport: {
        async execute(request: { url: string }) {
          calls.push(request);
          const username = new URL(request.url).searchParams.get("username") ?? "bullmacro";
          const id = username === "bearmacro" ? "bear-1" : "live-1";
          return {
            status: 200,
            body: { tweets: [tweet(id, false, username)] },
            billing: { usageCount: username === "bearmacro" ? 4 : 3 },
          };
        },
      } satisfies DesearchTransport,
    };
    let modelCalls = 0;
    const transport: ChutesTransport = {
      async post() {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      outlook: "bullish",
                      explanation: "The supplied original says growth remains constructive.",
                      evidencePostIds: ["live-1"],
                    }),
                    refusal: null,
                  },
                },
              ],
              usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
            }),
          };
        }
        return {
          status: 200,
          bodyText: JSON.stringify({
            choices: [
              {
                finish_reason: "refusal",
                message: { content: "", refusal: "no" },
              },
            ],
            usage: { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 },
          }),
        };
      },
    };
    const cache = createFetchSliceCache();
    await assert.rejects(
      () =>
        runReport(["bullmacro", "bearmacro"], question, {
          referenceDate: "2026-11-02",
          env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "2" }),
          cache,
          desearchTransport: posts.transport,
          chutesTransport: transport,
        }),
      (err: unknown) => {
        if (!(err instanceof ReportRunError)) return false;
        assert.equal(err.details.sliceStored, true);
        assert.deepEqual(
          err.details.providerUsages.map((usage) => usage.promptTokens),
          [11, 9],
        );
        assert.equal(err.details.billing.length, 2);
        assert.doesNotMatch(err.message, /Outlook: bullish/);
        return true;
      },
    );
    assert.equal(posts.calls.length, 2);
    assert.equal(modelCalls, 2);
  });

  it("hides provider exception text and keeps billing from responses already received", async () => {
    const fakeKey = "sk-live-FAKEKEY-SHOULD-NOT-PRINT";
    let calls = 0;
    const transport: DesearchTransport = {
      async execute(request) {
        calls += 1;
        const username = new URL(request.url).searchParams.get("username");
        if (username === "bullmacro") {
          return {
            status: 200,
            body: { tweets: [tweet("live-1", false)] },
            billing: { usageCount: 2 },
          };
        }
        throw new Error(`Desearch secret ${fakeKey}`);
      },
    };
    const model = chutesTransport({
      outlook: "bullish",
      explanation: "Should not be used.",
      evidencePostIds: ["live-1"],
    });
    const cache = createFetchSliceCache();
    await assert.rejects(
      () =>
        runReport(["bullmacro", "bearmacro"], question, {
          referenceDate: "2026-11-02",
          env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "2" }),
          cache,
          desearchTransport: transport,
          chutesTransport: model.transport,
        }),
      (err: unknown) => {
        if (!(err instanceof ReportRunError)) return false;
        assert.match(err.message, /Desearch HTTPS request failed/);
        assert.equal(err.message.includes(fakeKey), false);
        assert.equal(err.message.includes("secret"), false);
        assert.equal(err.details.sliceStored, false);
        assert.deepEqual(err.details.billing, [{ usageCount: 2 }]);
        assert.deepEqual(err.details.providerUsages, []);
        return true;
      },
    );
    assert.equal(calls, 2);
    assert.equal(model.calls.length, 0);

    await assert.rejects(
      () =>
        runReport(["bullmacro", "bearmacro"], question, {
          referenceDate: "2026-11-02",
          env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "2" }),
          cache,
          desearchTransport: transport,
          chutesTransport: model.transport,
        }),
      ReportRunError,
    );
    assert.equal(calls, 4);
  });

  it("reports HTTP status and billing without the provider error body", async () => {
    const fakeKey = "sk-live-FAKEKEY-SHOULD-NOT-PRINT";
    const transport: DesearchTransport = {
      async execute() {
        return {
          status: 401,
          body: { message: `rejected ${fakeKey}` },
          billing: { usageCount: 6, costUsd: 0.15 },
        };
      },
    };
    await assert.rejects(
      () =>
        runReport(["bullmacro"], question, {
          referenceDate: "2026-11-02",
          env: desearchEnv(),
          cache: createFetchSliceCache(),
          desearchTransport: transport,
          chutesTransport: chutesTransport({
            outlook: "unclear",
            explanation: "unused",
            evidencePostIds: [],
          }).transport,
        }),
      (err: unknown) =>
        err instanceof ReportRunError &&
        /HTTP 401/.test(err.message) &&
        !err.message.includes(fakeKey) &&
        err.details.billing[0]?.usageCount === 6 &&
        err.details.billing[0]?.costUsd === 0.15 &&
        err.details.sliceStored === false,
    );
  });
});
