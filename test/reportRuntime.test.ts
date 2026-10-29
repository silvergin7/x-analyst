import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";
import type { ChutesTransport } from "../src/analyze/chutesClient.js";
import type { DesearchTransport } from "../src/fetch/desearch/desearchTransport.js";
import { formatFullReport } from "../src/format/report.js";
import { createFetchSliceCache } from "../src/runtime/fetchCache.js";
import { ReportConfigError, ReportRunError, runReport } from "../src/runReport.js";
import { classifiedOutlook } from "./classifiedOutlook.js";
import { TEST_CHUTES_MODEL_ID, withTestChutesModelEnv } from "./support/chutesTestModel.js";
import { testChutesModelPlan } from "./support/testChutesModelPlan.js";

const question = { text: "What is each analyst's current market outlook?" };
const MODEL = TEST_CHUTES_MODEL_ID;
const testSliceDir = mkdtempSync(path.join(tmpdir(), "x-analyst-slices-"));

function desearchEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return withTestChutesModelEnv({
    POSTS_PROVIDER: "desearch",
    DESEARCH_LIVE_ENABLED: "true",
    DESEARCH_API_KEY: "unit-test-only-not-a-secret",
    DESEARCH_MAX_REQUESTS_PER_RUN: "1",
    DESEARCH_MAX_REQUESTS_PER_HANDLE: "3",
    LOOKBACK_DAYS: "400",
    ANALYSIS_PROVIDER: "chutes",
    LLM_LIVE_ENABLED: "true",
    CHUTES_API_KEY: "unit-test-only-not-a-secret",
    X_ANALYST_SLICE_DIR: testSliceDir,
    ...extra,
  });
}

function mockRunEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    X_ANALYST_SLICE_DIR: testSliceDir,
    ...extra,
  };
}

function withSliceDir(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const statePath = process.env.X_ANALYST_MODEL_STATE_PATH;
  const tokenizerCacheDir = process.env.X_ANALYST_TOKENIZER_CACHE_DIR;
  return {
    ...(typeof statePath === "string" && statePath.trim() !== ""
      ? { X_ANALYST_MODEL_STATE_PATH: statePath }
      : {}),
    ...(typeof tokenizerCacheDir === "string" && tokenizerCacheDir.trim() !== ""
      ? { X_ANALYST_TOKENIZER_CACHE_DIR: tokenizerCacheDir }
      : {}),
    ...env,
    X_ANALYST_SLICE_DIR: testSliceDir,
  };
}

function tweet(id: string, quote: boolean, username = "bullmacro") {
  return {
    id,
    text: quote ? "   " : "Growth remains constructive.",
    created_at: "2026-09-20T14:00:00.000Z",
    url: `https://x.com/example/status/${id}`,
    is_retweet: false,
    is_quote_tweet: quote,
    user: { username },
    ...(quote
      ? { quote: { text: "Quoted headline that must stay out of the prompt" } }
      : {}),
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

function classified(
  outlook: "bullish" | "bearish" | "cautious" | "mixed" | "unclear",
  explanation: string,
  aliases: string[],
) {
  const payload = classifiedOutlook({
    outlook,
    explanation,
    posts: aliases.map((postId) => ({
      postId,
      relevant: outlook !== "unclear",
      asset_class: outlook === "unclear" ? ("none" as const) : ("macro" as const),
      stance:
        outlook === "bullish"
          ? ("bullish" as const)
          : outlook === "bearish"
            ? ("bearish" as const)
            : ("unclear" as const),
    })),
  });
  return {
    outlook: payload.outlook,
    explanation: payload.explanation,
    posts: Object.fromEntries(
      payload.posts.map((post) => [
        post.postId,
        {
          relevant: post.relevant,
          asset_class: post.asset_class,
          stance: post.stance,
          reason: post.reason,
        },
      ]),
    ),
    assetOutlooks: payload.assetOutlooks,
  };
}

describe("runReport live gates", () => {
  beforeEach(() => installByteQuarterMockTokenizer());
  afterEach(() => clearMockTokenizer());

  it("uses only the explicit env object, not shell variables", async () => {
    const posts = desearchTransport([tweet("live-1", false)]);
    const previousPosts = process.env.POSTS_PROVIDER;
    const previousDesearch = process.env.DESEARCH_LIVE_ENABLED;
    process.env.POSTS_PROVIDER = "desearch";
    process.env.DESEARCH_LIVE_ENABLED = "true";
    process.env.DESEARCH_API_KEY = "shell-key-should-not-run";
    try {
      const result = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
        referenceDate: "2026-11-02",
        env: mockRunEnv(),
        cache: createFetchSliceCache(),
        desearchTransport: posts.transport,
      });
      assert.equal(posts.calls.length, 0);
      assert.equal(result.postsSource, "fixtures");
    } finally {
      if (previousPosts === undefined) delete process.env.POSTS_PROVIDER;
      else process.env.POSTS_PROVIDER = previousPosts;
      if (previousDesearch === undefined) delete process.env.DESEARCH_LIVE_ENABLED;
      else process.env.DESEARCH_LIVE_ENABLED = previousDesearch;
      delete process.env.DESEARCH_API_KEY;
    }
  });

  it("stays on fixtures and mock rules when providers are unset", async () => {
    const posts = desearchTransport([tweet("live-1", false)]);
    const model = chutesTransport({
      outlook: "bullish",
      explanation: "Should not be used.",
      evidencePostIds: ["p1"],
    });
    const result = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: mockRunEnv(),
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
      evidencePostIds: ["p1"],
    });
    const options = {
      referenceDate: "2026-11-02",
      cache: createFetchSliceCache(),
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    };
    await assert.rejects(
      () =>
        runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
          ...options,
          env: withSliceDir({ POSTS_PROVIDER: "desearch", ANALYSIS_PROVIDER: "mock" }),
        }),
      (err: unknown) => err instanceof ReportConfigError && /No request was sent/.test(err.message),
    );
    await assert.rejects(
      () =>
        runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
          ...options,
          env: withSliceDir({
            POSTS_PROVIDER: "desearch",
            DESEARCH_LIVE_ENABLED: "true",
            DESEARCH_API_KEY: "unit-test-only-not-a-secret",
            ANALYSIS_PROVIDER: "chutes",
            LLM_LIVE_ENABLED: "true",
          }),
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
        runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
          ...options,
          referenceDate: "2026-02-31",
          env: desearchEnv(),
        }),
      /No request was sent/,
    );
    assert.equal(posts.calls.length, 0);
    assert.equal(model.calls.length, 0);
  });

  it("stops a live Desearch fetch when the per-handle limit is missing", async () => {
    for (const value of [undefined, "", "nope", "0"] as const) {
      const posts = desearchTransport([tweet("live-1", false)]);
      const env = desearchEnv();
      if (value === undefined) delete env.DESEARCH_MAX_REQUESTS_PER_HANDLE;
      else env.DESEARCH_MAX_REQUESTS_PER_HANDLE = value;
      await assert.rejects(
        () =>
          runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
            referenceDate: "2026-11-02",
            env,
            cache: createFetchSliceCache(),
            desearchTransport: posts.transport,
            chutesTransport: chutesTransport(classified("bullish", "unused", ["p1"])).transport,
          }),
        (err: unknown) =>
          err instanceof ReportConfigError &&
          /DESEARCH_MAX_REQUESTS_PER_HANDLE must be a positive integer/.test(err.message) &&
          /No request was sent/.test(err.message),
      );
      assert.equal(posts.calls.length, 0);
    }
  });

  it("records elapsed time on a sent Chutes attempt", async () => {
    const posts = desearchTransport([tweet("live-1", false)]);
    const model = chutesTransport(
      classified("bullish", "The supplied original says growth remains constructive.", ["p1"]),
    );
    const result = await runReport(["bullmacro"], question, {
      chutesModelPlan: testChutesModelPlan(),
      referenceDate: "2026-11-02",
      env: desearchEnv(),
      cache: createFetchSliceCache(),
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    const attempt = result.reports[0]?.llmModelAttempts?.[0];
    assert.equal(attempt?.kind, "sent");
    assert.equal(Number.isFinite(attempt?.durationMs), true);
    assert.ok((attempt?.durationMs ?? -1) >= 0);
    const text = formatFullReport(question.text, [], result.reports, {
      postsSource: result.postsSource,
      analysisSource: result.analysisSource,
      referenceDate: result.referenceDate,
      fetchedAt: result.fetchedAt,
      reused: result.reused,
      billing: result.billing,
    });
    assert.match(text, /Chutes models: .* \(\d+ ms\)/);
  });

  it("sends retrieved posts to Chutes with the invocation date and no fixture wording", async () => {
    const posts = desearchTransport(
      [tweet("quote-1", true), tweet("live-1", false)],
      { usageCount: 10 },
    );
    const model = chutesTransport(classified(
      "bullish",
      "The supplied original says growth remains constructive.",
      ["p1"],
    ));
    const result = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
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

  it("keeps valid posts when one retrieved item is both a retweet and a quote", async () => {
    const posts = desearchTransport([
      tweet("live-1", false),
      {
        id: "mixed-5",
        text: "Sharing another account's market note.",
        created_at: "2026-10-08T15:00:00.000Z",
        url: "https://fixture.x-analyst.local/status/mixed-5",
        reply_count: 1,
        is_quote_tweet: true,
        is_retweet: true,
        user: { id: "1001", username: "bullmacro", name: "Sample Analyst" },
        quote: {
          id: "quoted-note",
          text: "Quoted text that must not become analyst commentary.",
        },
        retweet: {
          id: "reposted-note",
          text: "Reposted text that must not become analyst commentary.",
        },
      },
      tweet("live-2", false),
    ]);
    const model = chutesTransport(classified(
      "bullish",
      "The supplied originals say growth remains constructive.",
      ["p1", "p2"],
    ));
    const result = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: desearchEnv(),
      cache: createFetchSliceCache(),
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 1);
    assert.equal(model.calls.length, 1);
    const prompt = promptText(model.calls[0]!.body);
    assert.match(prompt, /Growth remains constructive/);
    assert.doesNotMatch(prompt, /Sharing another account/);
    assert.doesNotMatch(prompt, /Quoted text that must not/);
    assert.doesNotMatch(prompt, /Reposted text that must not/);
    const excluded = result.reports[0]?.analysisInput?.find(
      (record) => record.postId === "mixed-5",
    );
    assert.equal(excluded?.disposition, "excluded");
    assert.equal(excluded?.reason, "retweet_and_quote");
    const text = formatFullReport(question.text, [], result.reports, {
      postsSource: result.postsSource,
      analysisSource: result.analysisSource,
      referenceDate: result.referenceDate,
      fetchedAt: result.fetchedAt,
      reused: result.reused,
      billing: result.billing,
    });
    assert.match(text, /mixed-5 2026-10-08T15:00:00.000Z excluded \(retweet_and_quote,/);
    assert.match(text, /live-1 2026-09-20T14:00:00.000Z sent/);
    assert.match(text, /live-2 2026-09-20T14:00:00.000Z sent/);
  });

  it("sends a quote's own commentary and keeps every post from the paid response", async () => {
    const posts = desearchTransport([
      {
        id: "repost-1",
        text: "Reposted market note that must stay out.",
        created_at: "Mon Oct 05 01:00:00 +0000 2026",
        url: "https://fixture.x-analyst.local/status/repost-1",
        is_retweet: true,
        is_quote_tweet: false,
        user: { username: "bullmacro" },
      },
      {
        id: "quote-own",
        text: "I still see room for duration to rally.",
        created_at: "Fri Oct 09 05:35:09 +0000 2026",
        url: "https://fixture.x-analyst.local/status/quote-own",
        is_retweet: false,
        is_quote_tweet: true,
        user: { username: "bullmacro" },
        quote: { text: "Quoted account text that must stay out of the prompt." },
        retweet: { text: "Unused retweet field." },
      },
      tweet("live-1", false),
    ]);
    const commentary = "I still see room for duration to rally.";
    const quoted = "Quoted account text that must stay out of the prompt.";
    const model = chutesTransport(classified(
      "cautious",
      "The supplied commentary is about duration.",
      ["p1"],
    ));
    const result = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: desearchEnv({ LLM_INPUT_MAX_CHARS: String(commentary.length + quoted.length) }),
      cache: createFetchSliceCache(),
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 1);
    assert.equal(model.calls.length, 1);
    assert.equal(result.fetchOutcomes[0]?.status, "ok");
    if (result.fetchOutcomes[0]?.status === "ok") {
      assert.equal(result.fetchOutcomes[0].posts.length, 3);
    }
    const prompt = promptText(model.calls[0]!.body);
    assert.match(prompt, /I still see room for duration to rally/);
    assert.match(prompt, /quoted post: another account's post, context only, never the analyst's own words/);
    assert.match(prompt, /Quoted account text that must stay out of the prompt/);
    assert.match(prompt, /Never attribute quoted text to the analyst/);
    assert.doesNotMatch(prompt, /Growth remains constructive/);
    assert.doesNotMatch(prompt, /Unused retweet field/);
    assert.doesNotMatch(prompt, /Reposted market note/);
    const sentIds = result.reports[0]?.analysisInput
      ?.filter((record) => record.disposition === "sent")
      .map((record) => record.postId);
    assert.deepEqual(sentIds, ["quote-own"]);
    const excluded = result.reports[0]?.analysisInput?.find(
      (record) => record.postId === "repost-1",
    );
    assert.equal(excluded?.reason, "repost");
    assert.equal(excluded?.timestamp, "Mon Oct 05 01:00:00 +0000 2026");
    assert.equal(result.reports[0]?.dateRangeExamined?.from, "2026-09-20T14:00:00.000Z");
    assert.equal(result.reports[0]?.dateRangeExamined?.to, "Fri Oct 09 05:35:09 +0000 2026");
    const text = formatFullReport(question.text, [], result.reports, {
      postsSource: result.postsSource,
      analysisSource: result.analysisSource,
      referenceDate: result.referenceDate,
      fetchedAt: result.fetchedAt,
      reused: result.reused,
      billing: result.billing,
    });
    assert.match(
      text,
      /Date range of retrieved slice: 2026-09-20T14:00:00.000Z → Fri Oct 09 05:35:09 \+0000 2026/,
    );
    assert.match(text, /repost-1 Mon Oct 05 01:00:00 \+0000 2026 excluded \(repost,/);
    assert.match(text, /live-1 2026-09-20T14:00:00.000Z excluded \(beyond_input_character_budget,/);
  });

  it("returns local unclear and skips Chutes when only an uncommented quote was retrieved", async () => {
    const posts = desearchTransport([tweet("quote-1", true)]);
    const model = chutesTransport({
      outlook: "bullish",
      explanation: "Should not be used.",
      evidencePostIds: ["quote-1"],
    });
    const result = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
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
    const model = chutesTransport(classified(
      "bullish",
      "The supplied original says growth remains constructive.",
      ["p1"],
    ));
    const first = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "1" }),
      cache,
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    const second = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
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

    const fresh = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
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

    await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "2" }),
      cache,
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(posts.calls.length, 3);

    const replaced = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
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
    const result = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: desearchEnv(),
      cache: createFetchSliceCache(),
      desearchTransport: posts.transport,
      chutesTransport: model.transport,
    });
    assert.equal(result.reports.length, 0);
    assert.equal(result.handleFailures[0]?.providerUsage?.promptTokens, 9);
    assert.equal(result.reused, false);
    assert.equal(result.fetchedAt.length > 0, true);
    assert.equal(posts.calls.length, 1);
    assert.equal(model.calls.length, 1);
  });

  it("uses synthetic fixture wording only when the posts are fixtures", async () => {
    const posts = desearchTransport([tweet("live-1", false)]);
    const model = chutesTransport(classified(
      "bullish",
      "The fixture originals are constructive.",
      ["p1", "p2"],
    ));
    await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: withSliceDir({
        ANALYSIS_PROVIDER: "chutes",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "unit-test-only-not-a-secret",
        LLM_MODEL: MODEL,
      }),
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

  it("reports one failed handle and still analyzes the others", async () => {
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
    const order: string[] = [];
    const transport: ChutesTransport = {
      async post() {
        order.push("post");
        modelCalls += 1;
        if (modelCalls !== 2) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify(classified(
                      "bullish",
                      "The supplied original says growth remains constructive.",
                      ["p1"],
                    )),
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
    const result = await runReport(["bullmacro", "bearmacro", "other"], question, {
      chutesModelPlan: testChutesModelPlan(),
      referenceDate: "2026-11-02",
      env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "3" }),
      cache,
      desearchTransport: posts.transport,
      chutesTransport: transport,
      onEstimate: () => {
        order.push("estimate");
      },
    });
    assert.deepEqual(order, [
      "estimate",
      "post",
      "estimate",
      "post",
      "estimate",
      "post",
    ]);
    assert.equal(posts.calls.length, 3);
    assert.equal(modelCalls, 3);
    assert.deepEqual(
      result.reports.map((report) => report.handle),
      ["bullmacro", "other"],
    );
    assert.equal(result.handleFailures.length, 1);
    assert.equal(result.handleFailures[0]?.handle, "bearmacro");
    assert.match(result.handleFailures[0]?.message ?? "", /Chutes refused the request/);
    assert.equal(result.reports[0]?.providerUsage?.promptTokens, 11);
    assert.equal(result.handleFailures[0]?.providerUsage?.promptTokens, 9);
    assert.equal(result.billing.length, 3);
    const text = formatFullReport(
      question.text,
      [],
      result.reports,
      {
        postsSource: result.postsSource,
        analysisSource: result.analysisSource,
        referenceDate: result.referenceDate,
        fetchedAt: result.fetchedAt,
        reused: result.reused,
        billing: result.billing,
      },
      result.handleFailures,
    );
    assert.match(text, /@bullmacro/);
    assert.match(text, /Analysis failures:/);
    assert.match(text, /@bearmacro: Chutes refused the request/);
    assert.match(text, /Pessimistic estimate/);
    assert.match(text, /not provider-reported usage/);
    assert.match(text, /Desearch billing: usage_count=/);
    assert.match(text, /prompt_tokens=9/);
    assert.equal(typeof result.handleFailures[0]?.budgetEstimate?.estimatedUsd, "number");
    assert.equal(typeof result.reports[0]?.budgetEstimate?.estimatedUsd, "number");
  });

  it("hides provider exception text and keeps billing from responses already received", async () => {
    const fakeKey = "sk-live-FAKEKEY-SHOULD-NOT-PRINT";
    let calls = 0;
    const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-slice-partial-"));
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
    const model = chutesTransport(
      classified("bullish", "Constructive on growth.", ["p1"]),
    );
    const cache = createFetchSliceCache();
    const result = await runReport(["bullmacro", "bearmacro"], question, {
      chutesModelPlan: testChutesModelPlan(),
      referenceDate: "2026-11-02",
      env: desearchEnv({ DESEARCH_MAX_REQUESTS_PER_RUN: "2", X_ANALYST_SLICE_DIR: dir }),
      cache,
      sliceDirectory: dir,
      desearchTransport: transport,
      chutesTransport: model.transport,
    });
    assert.equal(calls, 2);
    assert.equal(model.calls.length, 1);
    assert.equal(result.fetchOutcomes[0]?.status, "ok");
    assert.equal(result.fetchOutcomes[1]?.status, "retrieval_failed");
    assert.deepEqual(result.billing, [{ usageCount: 2 }]);
    assert.equal(result.reports.length, 1);
    assert.equal(readdirSync(dir).length, 1);
  });

  it("reports HTTP status and billing without the provider error body", async () => {
    const fakeKey = "sk-live-FAKEKEY-SHOULD-NOT-PRINT";
    const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-slice-401-"));
    const transport: DesearchTransport = {
      async execute() {
        return {
          status: 401,
          body: { message: `rejected ${fakeKey}` },
          billing: { usageCount: 6, costUsd: 0.15 },
        };
      },
    };
    const result = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: desearchEnv({ X_ANALYST_SLICE_DIR: dir }),
      cache: createFetchSliceCache(),
      sliceDirectory: dir,
      desearchTransport: transport,
      chutesTransport: chutesTransport({
        outlook: "unclear",
        explanation: "unused",
        evidencePostIds: [],
      }).transport,
    });
    assert.equal(result.fetchOutcomes[0]?.status, "retrieval_failed");
    if (result.fetchOutcomes[0]?.status === "retrieval_failed") {
      assert.equal(result.fetchOutcomes[0].httpStatus, 401);
      assert.equal(result.fetchOutcomes[0].reason.includes(fakeKey), false);
    }
    assert.equal(result.billing[0]?.usageCount, 6);
    assert.equal(result.billing[0]?.costUsd, 0.15);
    assert.equal(result.reports.length, 0);
    assert.equal(readdirSync(dir).length, 1);
  });

  it("saves a slice and replays it without calling Desearch", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-slice-"));
    const commit = "a".repeat(40);
    const saved = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: withSliceDir({
        POSTS_PROVIDER: "mock",
        ANALYSIS_PROVIDER: "mock",
        DESEARCH_LIVE_ENABLED: "false",
        LLM_LIVE_ENABLED: "false",
        CHUTES_API_KEY: "",
        DESEARCH_API_KEY: "",
      }),
      cache: createFetchSliceCache(),
      sliceDirectory: dir,
      readCommit: () => commit,
    });
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    const raw = readFileSync(path.join(dir, files[0]!), "utf8");
    assert.equal(raw.includes("billing"), false);
    assert.equal(raw.includes("authorization"), false);
    const transport: DesearchTransport = {
      async execute() {
        throw new Error("Desearch must not be called");
      },
    };
    const replayed = await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      replayPath: path.join(dir, files[0]!),
      env: withSliceDir({
        POSTS_PROVIDER: "desearch",
        DESEARCH_LIVE_ENABLED: "true",
        DESEARCH_API_KEY: "unit-test-only-not-a-secret",
        ANALYSIS_PROVIDER: "mock",
        LLM_LIVE_ENABLED: "false",
        CHUTES_API_KEY: "",
      }),
      cache: createFetchSliceCache(),
      sliceDirectory: dir,
      desearchTransport: transport,
    });
    assert.equal(readdirSync(dir).length, 1);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.fetchedCommit, commit);
    assert.equal(replayed.fetchedAt, saved.fetchedAt);
    assert.equal(replayed.postsSource, "fixtures");
    assert.equal(replayed.analysisSource, "mock-rules");
    const text = formatFullReport(question.text, [], replayed.reports, {
      postsSource: replayed.postsSource,
      analysisSource: replayed.analysisSource,
      referenceDate: replayed.referenceDate,
      fetchedAt: replayed.fetchedAt,
      fetchedCommit: replayed.fetchedCommit,
      reused: replayed.reused,
      replayed: replayed.replayed,
      billing: replayed.billing,
    });
    assert.match(text, /Slice: replayed/);
    assert.match(text, new RegExp(`Fetched at: ${saved.fetchedAt}`));
    assert.match(text, new RegExp(`Fetched commit: ${commit}`));
  });

  it("still calls Chutes when a replay selects live analysis", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-slice-"));
    await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: withSliceDir({ POSTS_PROVIDER: "mock", ANALYSIS_PROVIDER: "mock" }),
      cache: createFetchSliceCache(),
      sliceDirectory: dir,
      readCommit: () => "e".repeat(40),
    });
    const file = path.join(dir, readdirSync(dir)[0]!);
    let desearchCalls = 0;
    const model = chutesTransport(classified(
      "bullish",
      "The supplied originals say growth remains constructive.",
      ["p1", "p2"],
    ));
    await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      replayPath: file,
      env: desearchEnv(),
      cache: createFetchSliceCache(),
      sliceDirectory: dir,
      desearchTransport: {
        async execute() {
          desearchCalls += 1;
          throw new Error("Desearch must not be called");
        },
      },
      chutesTransport: model.transport,
    });
    assert.equal(desearchCalls, 0);
    assert.equal(model.calls.length, 1);
    assert.equal(readdirSync(dir).length, 1);
  });

  it("rejects a replay whose handles do not match before any request", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-slice-"));
    await runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
      referenceDate: "2026-11-02",
      env: withSliceDir({ POSTS_PROVIDER: "mock", ANALYSIS_PROVIDER: "mock" }),
      cache: createFetchSliceCache(),
      sliceDirectory: dir,
      readCommit: () => "b".repeat(40),
    });
    const file = path.join(dir, readdirSync(dir)[0]!);
    const transport: DesearchTransport = {
      async execute() {
        throw new Error("Desearch must not be called");
      },
    };
    await assert.rejects(
      () =>
        runReport(["otherhandle"], question, {
          chutesModelPlan: testChutesModelPlan(),
          referenceDate: "2026-11-02",
          replayPath: file,
          env: desearchEnv(),
          cache: createFetchSliceCache(),
          desearchTransport: transport,
        }),
      (err: unknown) =>
        err instanceof ReportConfigError &&
        /No request was sent/.test(err.message),
    );
  });

  it("rejects replay combined with a fresh fetch before any request", async () => {
    await assert.rejects(
      () =>
        runReport(["bullmacro"], question, { chutesModelPlan: testChutesModelPlan(), 
          referenceDate: "2026-11-02",
          fresh: true,
          replayPath: "missing-slice.json",
          env: desearchEnv(),
          cache: createFetchSliceCache(),
          desearchTransport: {
            async execute() {
              throw new Error("Desearch must not be called");
            },
          },
        }),
      (err: unknown) =>
        err instanceof ReportConfigError && /--replay/.test(err.message),
    );
  });
});
