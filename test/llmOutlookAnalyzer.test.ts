import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planAnalysisInput } from "../src/analyze/analysisInput.js";
import {
  buildChatMessages,
  buildChutesRequestBody,
  estimateRequestBudget,
} from "../src/analyze/llmPrompt.js";
import { classificationOutputTokenCeiling } from "../src/analyze/outputBudget.js";
import { classifiedOutlook } from "./classifiedOutlook.js";
import { formatPersonReport } from "../src/format/report.js";
import {
  LlmCallError,
  requestChutesCompletion,
  type ChutesTransport,
} from "../src/analyze/chutesClient.js";
import { LlmCitationError, LlmOutlookAnalyzer, LlmOutputError } from "../src/analyze/llmOutlookAnalyzer.js";
import {
  LLM_CALL_BUDGET_USD,
  LLM_INPUT_MAX_CHARS,
  PRICED_LLM_MODEL,
  loadLlmRuntimeConfig,
} from "../src/config/llmSettings.js";
import { runReport } from "../src/runReport.js";
import { runLlmFixtureCheck } from "../src/llmFixtureCheck.js";
import type { LlmRuntimeConfig } from "../src/config/llmSettings.js";
import type { Post } from "../src/types.js";

const question = { text: "What is each analyst's current market outlook?" };
const complete = { retrievalComplete: true as const };

function post(overrides: Partial<Post> & Pick<Post, "id" | "kind" | "text">): Post {
  return {
    authorHandle: "analyst",
    timestamp: "2026-09-20T00:00:00.000Z",
    url: `https://fixture.x-analyst.local/posts/analyst/${overrides.id}`,
    ...overrides,
  };
}

function liveEnv(): NodeJS.ProcessEnv {
  return {
    ANALYSIS_PROVIDER: "chutes",
    LLM_LIVE_ENABLED: "true",
    CHUTES_API_KEY: "test-key",
    LLM_MODEL: PRICED_LLM_MODEL,
  };
}

function liveConfig(overrides: Partial<LlmRuntimeConfig> = {}): LlmRuntimeConfig {
  return {
    provider: "chutes",
    liveEnabled: true,
    apiKey: "test-key",
    model: PRICED_LLM_MODEL,
    eligible: true,
    ...overrides,
  };
}

function recordingTransport(response?: { status: number; bodyText: string }, fail?: Error) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const transport: ChutesTransport = {
    async post(url, request) {
      calls.push({ url: url, body: request.body, headers: request.headers });
      if (fail) throw fail;
      return response ?? { status: 200, bodyText: "{}" };
    },
  };
  return { calls, transport };
}

function completion(content: unknown, extra?: {
  finish_reason?: string;
  refusal?: string | null;
  usage?: Record<string, number> | null;
}): { status: number; bodyText: string } {
  const payload: Record<string, unknown> = {
    choices: [
      {
        finish_reason: extra?.finish_reason ?? "stop",
        message: {
          content: typeof content === "string" ? content : JSON.stringify(content),
          refusal: extra?.refusal ?? null,
        },
      },
    ],
  };
  if (extra?.usage !== null) {
    payload.usage = extra?.usage ?? {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
    };
  }
  return { status: 200, bodyText: JSON.stringify(payload) };
}

describe("LlmOutlookAnalyzer", () => {
  it("blocks a call when any live gate fails", async () => {
    const cases = [
      {},
      { ANALYSIS_PROVIDER: "chutes", LLM_LIVE_ENABLED: "false", CHUTES_API_KEY: "test-key" },
      {
        ANALYSIS_PROVIDER: "chutes",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "replace_me_only_when_you_are_ready",
      },
      {
        ANALYSIS_PROVIDER: "chutes",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "test-key",
        LLM_MODEL: "other-model",
      },
      {
        ANALYSIS_PROVIDER: "mock",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "test-key",
        LLM_MODEL: PRICED_LLM_MODEL,
      },
    ];
    for (const env of cases) {
      const recorded = recordingTransport(completion({
        outlook: "bullish",
        explanation: "Should not be used.",
        evidencePostIds: ["o1"],
      }));
      const analyzer = new LlmOutlookAnalyzer(
        loadLlmRuntimeConfig(env),
        recorded.transport,
      );
      await assert.rejects(
        () => analyzer.analyzePerson("analyst", [
          post({ id: "o1", kind: "original", text: "Risk assets have room to run." }),
        ], question, complete),
        (err: unknown) => err instanceof LlmCallError && err.code === "gate",
      );
      assert.equal(recorded.calls.length, 0);
    }
  });

  it("returns unclear with zero calls when nothing is eligible", async () => {
    const recorded = recordingTransport();
    const analyzer = new LlmOutlookAnalyzer(liveConfig(), recorded.transport);
    const report = await analyzer.analyzePerson("analyst", [
      post({ id: "r1", kind: "repost", text: "RT someone else" }),
      post({ id: "q1", kind: "quote", text: "Quoted headline" }),
    ], question, complete);
    assert.equal(recorded.calls.length, 0);
    assert.equal(report.outlook, "unclear");
    assert.equal(report.modelInvoked, false);
    assert.equal(report.postsExamined, 0);
    assert.deepEqual(report.dateRangeExamined, {
      from: "2026-09-20T00:00:00.000Z",
      to: "2026-09-20T00:00:00.000Z",
    });
    assert.equal(report.evidence.length, 0);
    assert.deepEqual(
      report.analysisInput?.map((item) => item.reason),
      ["repost", "quote_without_analyst_commentary"],
    );
  });

  it("sends quote commentary only and rejects unknown or duplicate citation ids", async () => {
    const posts = [
      post({
        id: "q1",
        kind: "quote",
        text: "QUOTED TEXT SHOULD NOT APPEAR",
        analystComment: "My own cautious comment",
      }),
      post({ id: "r1", kind: "repost", text: "REPOST TEXT SHOULD NOT APPEAR" }),
    ];
    const ok = recordingTransport(completion(classifiedOutlook({
      outlook: "cautious",
      explanation: "The commentary is cautious.",
      posts: [{ postId: "q1", relevant: true, asset_class: "macro", stance: "bearish" }],
    })));
    const analyzer = new LlmOutlookAnalyzer(liveConfig(), ok.transport);
    const report = await analyzer.analyzePerson("analyst", posts, question, complete);
    assert.equal(ok.calls.length, 1);
    const body = JSON.parse(ok.calls[0]!.body) as {
      max_tokens: number;
      messages: { content: string }[];
      response_format: { json_schema: { strict: boolean } };
    };
    const prompt = body.messages.map((message) => message.content).join("\n");
    assert.equal(body.max_tokens, classificationOutputTokenCeiling(1));
    assert.match(prompt, /\/no_think/);
    assert.match(prompt, /My own cautious comment/);
    assert.equal(prompt.includes("QUOTED TEXT SHOULD NOT APPEAR"), false);
    assert.equal(prompt.includes("REPOST TEXT SHOULD NOT APPEAR"), false);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(report.evidence[0]?.url, posts[0]!.url);
    assert.equal(report.evidence[0]?.kind, "quote");
    assert.equal(report.postsExamined, 1);
    assert.equal(report.providerUsage?.totalTokens, 18);

    for (const postsPayload of [
      [{ postId: "missing", relevant: true, asset_class: "macro" as const, stance: "bearish" as const }],
      [
        { postId: "q1", relevant: true, asset_class: "macro" as const, stance: "bearish" as const },
        { postId: "q1", relevant: true, asset_class: "macro" as const, stance: "bearish" as const },
      ],
    ]) {
      const recorded = recordingTransport(completion(classifiedOutlook({
        outlook: "cautious",
        explanation: "Bad citations.",
        posts: postsPayload,
      })));
      const failing = new LlmOutlookAnalyzer(liveConfig(), recorded.transport);
      await assert.rejects(
        () => failing.analyzePerson("analyst", posts, question, complete),
        (err: unknown) => err instanceof LlmCitationError,
      );
      assert.equal(recorded.calls.length, 1);
    }
  });

  it("fails a refusal or exhausted output without a second request", async () => {
    const posts = [post({ id: "o1", kind: "original", text: "Staying constructive." })];
    const refusal = recordingTransport(completion("no", { refusal: "refused" }));
    const length = recordingTransport(completion("{", { finish_reason: "length" }));
    const refusalAnalyzer = new LlmOutlookAnalyzer(liveConfig(), refusal.transport);
    const lengthAnalyzer = new LlmOutlookAnalyzer(liveConfig(), length.transport);
    await assert.rejects(
      () => refusalAnalyzer.analyzePerson("analyst", posts, question, complete),
      (err: unknown) => err instanceof LlmCallError && err.code === "refusal",
    );
    await assert.rejects(
      () => lengthAnalyzer.analyzePerson("analyst", posts, question, complete),
      (err: unknown) => err instanceof LlmCallError && err.code === "length",
    );
    assert.equal(refusal.calls.length, 1);
    assert.equal(length.calls.length, 1);
  });

  it("fails a non-200 response, a timeout, and invalid JSON after one attempt", async () => {
    const posts = [post({ id: "o1", kind: "original", text: "Staying constructive." })];
    const http = recordingTransport({ status: 503, bodyText: "unavailable" });
    const timeout = recordingTransport(undefined, Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    const invalid = recordingTransport(completion("not-json"));
    await assert.rejects(
      () => new LlmOutlookAnalyzer(liveConfig(), http.transport).analyzePerson("analyst", posts, question, complete),
      (err: unknown) => err instanceof LlmCallError && err.code === "http",
    );
    await assert.rejects(
      () => new LlmOutlookAnalyzer(liveConfig(), timeout.transport).analyzePerson("analyst", posts, question, complete),
      (err: unknown) => err instanceof LlmCallError && err.code === "timeout",
    );
    await assert.rejects(
      () => new LlmOutlookAnalyzer(liveConfig(), invalid.transport).analyzePerson("analyst", posts, question, complete),
      (err: unknown) => err instanceof LlmOutputError,
    );
    assert.equal(http.calls.length, 1);
    assert.equal(timeout.calls.length, 1);
    assert.equal(invalid.calls.length, 1);
  });

  it("rejects an over-budget request before any HTTP call", async () => {
    const recorded = recordingTransport();
    const messages = [
      { role: "system" as const, content: "/no_think" },
      { role: "user" as const, content: "x".repeat(600_000) },
    ];
    await assert.rejects(
      () => requestChutesCompletion(liveConfig(), messages, recorded.transport),
      (err: unknown) => err instanceof LlmCallError && err.code === "budget",
    );
    assert.equal(recorded.calls.length, 0);
  });

  it("prices a normal classification under $0.05 and rejects the one-character worst case", async () => {
    const modest = Array.from({ length: 60 }, (_, index) =>
      post({
        id: `modest-${index}`,
        kind: "original",
        text: "Risk assets can still reprice if growth cools from here.",
      }),
    );
    const modestPlan = planAnalysisInput(modest, "analyst");
    const modestEstimate = estimateRequestBudget(
      buildChutesRequestBody(
        buildChatMessages(question.text, modestPlan.sent, "2026-10-10", "desearch"),
        PRICED_LLM_MODEL,
        classificationOutputTokenCeiling(modestPlan.sent.length),
      ),
    );
    assert.equal(modestPlan.sent.length, 60);
    assert.ok(modestEstimate.estimatedUsd <= LLM_CALL_BUDGET_USD);

    const tiny = Array.from({ length: LLM_INPUT_MAX_CHARS }, (_, index) =>
      post({ id: `tiny-${index}`, kind: "original", text: "y" }),
    );
    const tinyPlan = planAnalysisInput(tiny, "analyst");
    assert.equal(tinyPlan.sent.length, LLM_INPUT_MAX_CHARS);
    const recorded = recordingTransport();
    await assert.rejects(
      () =>
        requestChutesCompletion(
          liveConfig(),
          buildChatMessages(question.text, tinyPlan.sent, "2026-10-10", "desearch"),
          recorded.transport,
          classificationOutputTokenCeiling(tinyPlan.sent.length),
        ),
      (err: unknown) => err instanceof LlmCallError && err.code === "budget",
    );
    assert.equal(recorded.calls.length, 0);
  });

  it("rejects a question past the character bound with zero calls", async () => {
    const recorded = recordingTransport();
    const analyzer = new LlmOutlookAnalyzer(liveConfig(), recorded.transport);
    await assert.rejects(
      () => analyzer.analyzePerson(
        "analyst",
        [post({ id: "o1", kind: "original", text: "room to run" })],
        { text: "q".repeat(501) },
        complete,
      ),
      (err: unknown) => err instanceof LlmOutputError,
    );
    assert.equal(recorded.calls.length, 0);
  });

  it("discloses truncation and keeps retrieval coverage separate", async () => {
    const text = `${"a".repeat(1000)}ENDMARK`;
    const recorded = recordingTransport(completion(classifiedOutlook({
      outlook: "unclear",
      explanation: "Not enough to call a stance.",
      posts: [{ postId: "o1", relevant: false }],
    }), { usage: null }));
    const analyzer = new LlmOutlookAnalyzer(liveConfig(), recorded.transport);
    const report = await analyzer.analyzePerson(
      "analyst",
      [post({ id: "o1", kind: "original", text, timestamp: "2026-09-02T00:00:00.000Z" })],
      question,
      { retrievalComplete: false, incompleteReason: "per_person_limit_reached" },
    );
    const prompt = JSON.parse(recorded.calls[0]!.body).messages[1].content as string;
    assert.equal(prompt.includes("ENDMARK"), false);
    assert.equal(report.analysisInput?.[0]?.disposition, "truncated");
    assert.equal(report.analysisInput?.[0]?.originalChars, 1007);
    assert.equal(report.analysisInput?.[0]?.sentChars, 1000);
    assert.equal(report.postsExamined, 1);
    assert.equal(report.retrievalIncompleteReason, "per_person_limit_reached");
    assert.equal(report.modelInvoked, true);
    assert.equal(report.providerUsage, null);
  });

  it("lists eligible posts that do not fit the character budget", () => {
    const posts = [
      post({
        id: "older",
        kind: "original",
        text: "bbbb",
        timestamp: "Mon Oct 05 01:00:00 +0000 2026",
      }),
      post({
        id: "newer",
        kind: "original",
        text: "aaaa",
        timestamp: "Fri Oct 09 05:35:09 +0000 2026",
      }),
      post({
        id: "noise-repost",
        kind: "repost",
        text: "not eligible",
        timestamp: "2026-10-08T00:00:00.000Z",
      }),
    ];
    const plan = planAnalysisInput(posts, "analyst", { inputMaxChars: 4 });
    assert.deepEqual(
      plan.records.map((record) => record.postId),
      ["newer", "noise-repost", "older"],
    );
    assert.equal(plan.sent.length, 1);
    assert.equal(plan.sent[0]?.post.id, "newer");
    const excluded = plan.records.find((record) => record.postId === "older");
    assert.equal(excluded?.disposition, "excluded");
    assert.equal(excluded?.reason, "beyond_input_character_budget");
    assert.equal(plan.records.find((record) => record.postId === "noise-repost")?.reason, "repost");
  });

  it("orders posts by parsed time, newest first", () => {
    const plan = planAnalysisInput(
      [
        post({
          id: "a",
          kind: "original",
          text: "older",
          timestamp: "Sat Oct 03 00:00:00 +0000 2026",
        }),
        post({
          id: "z",
          kind: "original",
          text: "newer",
          timestamp: "Fri Oct 09 00:00:00 +0000 2026",
        }),
      ],
      "analyst",
    );
    assert.deepEqual(
      plan.records.map((record) => record.postId),
      ["z", "a"],
    );
    const windowed = planAnalysisInput(
      [
        post({
          id: "inside",
          kind: "original",
          text: "inside the window",
          timestamp: "2026-09-10T00:00:00.000Z",
        }),
        post({
          id: "outside",
          kind: "original",
          text: "before the window",
          timestamp: "2026-09-09T23:59:59.000Z",
        }),
      ],
      "analyst",
      { lookbackCutoffMs: Date.parse("2026-09-10T00:00:00.000Z") },
    );
    assert.deepEqual(windowed.sent.map((item) => item.post.id), ["inside"]);
    assert.equal(
      windowed.records.find((record) => record.postId === "outside")?.reason,
      "outside_lookback_window",
    );
  });

  it("validates citations from a noisy slice that has two relevant posts", async () => {
    const noise = ["pasta", "hiking", "playlist", "weather", "birthday", "garden"];
    const posts = [
      ...noise.map((topic, index) =>
        post({
          id: `noise-${index}`,
          kind: "original" as const,
          text: `Today I enjoyed ${topic}.`,
          timestamp: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        }),
      ),
      post({
        id: "rates",
        kind: "original",
        text: "Real yields still look too high for risk assets.",
        timestamp: "2026-10-08T12:00:00.000Z",
      }),
      post({
        id: "payrolls",
        kind: "original",
        text: "Soft payrolls would make me less bearish on duration.",
        timestamp: "2026-10-09T12:00:00.000Z",
      }),
      post({
        id: "repost-1",
        kind: "repost",
        text: "Someone else's market note.",
        timestamp: "2026-10-09T18:00:00.000Z",
      }),
    ];
    const recorded = recordingTransport(completion(classifiedOutlook({
      outlook: "cautious",
      explanation: "The two market posts are cautious. The other posts are unrelated.",
      posts: [
        ...noise.map((_, index) => ({ postId: `noise-${index}`, relevant: false })),
        {
          postId: "payrolls",
          relevant: true,
          asset_class: "rates_bonds" as const,
          stance: "bullish" as const,
        },
        {
          postId: "rates",
          relevant: true,
          asset_class: "rates_bonds" as const,
          stance: "bearish" as const,
        },
      ],
    })));
    const analyzer = new LlmOutlookAnalyzer(liveConfig(), recorded.transport, "2026-10-10");
    const report = await analyzer.analyzePerson("analyst", posts, question, complete);
    assert.deepEqual(
      report.evidence.map((item) => item.postId),
      ["payrolls", "rates"],
    );
    assert.equal(report.relevantPostCount, 2);
    assert.equal(report.eligiblePostCount, 8);
    assert.equal(report.newestRelevantPostAt, "2026-10-09T12:00:00.000Z");
    assert.equal(report.viewMayBeStale, false);
    const sentIds = new Set(report.analysisInput?.filter((record) => record.sentChars > 0).map((record) => record.postId));
    for (const item of report.evidence) {
      assert.equal(sentIds.has(item.postId), true);
    }
    const rejected = recordingTransport(completion(classifiedOutlook({
      outlook: "cautious",
      explanation: "Cited a post that was not sent.",
      posts: [{ postId: "repost-1", relevant: true, asset_class: "macro", stance: "bearish" }],
    })));
    const rejecting = new LlmOutlookAnalyzer(liveConfig(), rejected.transport, "2026-10-10");
    await assert.rejects(
      () => rejecting.analyzePerson("analyst", posts, question, complete),
      (err: unknown) => err instanceof LlmCitationError,
    );
  });

  it("warns when the newest relevant post is older than 14 days and shows text excerpts", async () => {
    const commentary = `Duration still looks attractive if growth cools. ${"c".repeat(80)}`;
    const quoted = `Quoted account says something else entirely. ${"q".repeat(80)}`;
    const posts = [
      post({
        id: "old-view",
        kind: "quote",
        text: "timeline text that is not the commentary",
        analystComment: commentary,
        quotedPostText: quoted,
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      post({
        id: "fresh-noise",
        kind: "original",
        text: "Photos from a walk.",
        timestamp: "2026-10-09T00:00:00.000Z",
      }),
    ];
    const recorded = recordingTransport(completion(classifiedOutlook({
      outlook: "cautious",
      explanation: "The only market post is an older comment on duration.",
      posts: [
        { postId: "fresh-noise", relevant: false },
        {
          postId: "old-view",
          relevant: true,
          asset_class: "rates_bonds",
          stance: "bullish",
        },
      ],
    })));
    const analyzer = new LlmOutlookAnalyzer(liveConfig(), recorded.transport, "2026-10-10");
    const report = await analyzer.analyzePerson("analyst", posts, question, {
      retrievalComplete: true,
      fetchStopReason: "lookback_window_reached",
    });
    assert.equal(report.viewMayBeStale, true);
    assert.equal(report.newestRelevantPostAt, "2026-09-01T00:00:00.000Z");
    assert.equal(report.relevantPostCount, 1);
    assert.equal(report.eligiblePostCount, 2);
    const sent = report.analysisInput?.find((record) => record.postId === "old-view");
    assert.equal(sent?.sentExcerpt, commentary.slice(0, 100));
    assert.equal(sent?.sentExcerpt?.length, 100);
    assert.equal(sent?.quotedPostExcerpt, quoted.slice(0, 100));
    assert.equal(sent?.quotedPostExcerpt?.length, 100);
    assert.equal(report.analysisInput?.[0]?.postId, "fresh-noise");
    const text = formatPersonReport(report);
    assert.match(text, /Relevant posts: 1 of 2 eligible/);
    assert.match(text, /Newest relevant post: 2026-09-01T00:00:00.000Z/);
    assert.match(text, /rates_bonds: cautious/);
    assert.match(text, /rates_bonds: The newest relevant post is older than 14 days\. The view may be stale\./);
    assert.equal(report.assetOutlooks?.[0]?.assetClass, "rates_bonds");
    assert.deepEqual(
      report.assetOutlooks?.[0]?.evidence.map((item) => item.postId),
      ["old-view"],
    );
    assert.match(text, /Sent text: Duration still looks attractive/);
    assert.match(text, /Quoted post text: Quoted account says something else entirely/);
    assert.match(text, /Fetch stopped: oldest post is past the lookback window/);
    assert.equal(text.includes(`Sent text: ${commentary.slice(0, 100)}`), true);
    assert.equal(text.includes(`Quoted post text: ${quoted.slice(0, 100)}`), true);
    assert.equal(text.includes(commentary), false);
    assert.equal(text.includes(quoted), false);
  });

  it("reports removed duplicate ids and media the model cannot see", async () => {
    const recorded = recordingTransport(completion(classifiedOutlook({
      outlook: "unclear",
      explanation: "The post is not about markets.",
      posts: [{ postId: "m1", relevant: false }],
    })));
    const analyzer = new LlmOutlookAnalyzer(liveConfig(), recorded.transport, "2026-10-10");
    const report = await analyzer.analyzePerson(
      "analyst",
      [post({
        id: "m1",
        kind: "original",
        text: "A walk in the park.",
        hasAttachedMedia: true,
      })],
      question,
      { retrievalComplete: true, duplicatePostsRemoved: 1 },
    );
    const prompt = JSON.parse(recorded.calls[0]!.body).messages
      .map((message: { content: string }) => message.content)
      .join("\n");
    assert.match(prompt, /media: this post includes media/);
    assert.match(prompt, /cannot be seen/);
    assert.match(prompt, /Do not invent what that media shows/);
    assert.equal(report.postsWithMedia, 1);
    assert.equal(report.duplicatePostsRemoved, 1);
    const text = formatPersonReport(report);
    assert.match(text, /Duplicate post ids removed: 1/);
    assert.match(text, /Posts with media: 1/);
  });

  it("sends sarcasm, conflict, staleness, and interpretation rules with the reference date", async () => {
    const recorded = recordingTransport(completion(classifiedOutlook({
      outlook: "unclear",
      explanation: "The fixture text does not support a stance.",
      posts: [{ postId: "o1", relevant: false }],
    })));
    const analyzer = new LlmOutlookAnalyzer(liveConfig(), recorded.transport, "2026-09-22");
    const report = await analyzer.analyzePerson(
      "analyst",
      [post({ id: "o1", kind: "original", text: "Maybe constructive if payroll holds." })],
      question,
      complete,
    );
    const prompt = (JSON.parse(recorded.calls[0]!.body) as {
      messages: { content: string }[];
    }).messages.map((message) => message.content).join("\n");
    assert.match(prompt, /markets, the economy, assets, or risk/);
    assert.match(prompt, /too few relevant posts/);
    assert.match(prompt, /Supplied posts, newest first/);
    assert.match(prompt, /Analysis reference date: 2026-09-22/);
    assert.match(prompt, /sarcasm/);
    assert.match(prompt, /conditional views/);
    assert.match(prompt, /conflict/);
    assert.match(prompt, /stale views/);
    assert.match(prompt, /newer statements/);
    assert.match(prompt, /your interpretation/);
    assert.match(prompt, /not current real-world research/);
    assert.equal(report.analysisReferenceDate, "2026-09-22");
    assert.match(report.explanation, /fixture text/);
  });

  it("keeps the shared report path on the mock analyzer when analysis gates are unset", async () => {
    const result = await runReport(["bullmacro"], question, {
      referenceDate: "2026-10-09",
      env: {},
    });
    assert.equal(result.postsSource, "fixtures");
    assert.equal(result.analysisSource, "mock-rules");
    assert.equal(result.reports[0]?.analysisSource, "mock");
    assert.match(result.reports[0]?.explanation ?? "", /Mock analysis/);
  });
});

describe("runLlmFixtureCheck", () => {
  it("does not call Chutes when the live gates are closed", async () => {
    const recorded = recordingTransport();
    let output = "";
    const code = await runLlmFixtureCheck({
      handle: "bullmacro",
      question: question.text,
      env: {},
      transport: recorded.transport,
      write: (text) => {
        output += text;
      },
    });
    assert.equal(code, 1);
    assert.equal(recorded.calls.length, 0);
    assert.match(output, /ANALYSIS_PROVIDER/);
  });

  it("posts the edited fixture handle with max_tokens and prints the estimate before usage", async () => {
    const recorded = recordingTransport(completion(classifiedOutlook({
      outlook: "bullish",
      explanation: "The originals are constructive.",
      posts: [
        { postId: "b1", relevant: true, asset_class: "macro", stance: "bullish" },
        { postId: "b2", relevant: true, asset_class: "equities", stance: "bullish" },
      ],
    })));
    let output = "";
    const code = await runLlmFixtureCheck({
      handle: "bullmacro",
      question: "Edited fixture question",
      env: {
        ANALYSIS_PROVIDER: "chutes",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "test-key",
        LLM_MODEL: PRICED_LLM_MODEL,
      },
      transport: recorded.transport,
      write: (text) => {
        output += text;
      },
    });
    assert.equal(code, 0);
    assert.equal(recorded.calls.length, 1);
    assert.equal(recorded.calls[0]?.url, "https://llm.chutes.ai/v1/chat/completions");
    assert.equal(recorded.calls[0]?.headers.Authorization, "Bearer test-key");
    assert.equal(recorded.calls[0]?.headers["Content-Type"], "application/json");
    const body = JSON.parse(recorded.calls[0]!.body) as {
      model: string;
      max_tokens: number;
      temperature: number;
      top_p: number;
      top_k: number;
      messages: { content: string }[];
    };
    assert.equal(body.model, PRICED_LLM_MODEL);
    assert.equal(body.max_tokens, classificationOutputTokenCeiling(2));
    assert.equal(body.temperature, 0.7);
    assert.equal(body.top_p, 0.8);
    assert.equal(body.top_k, 20);
    assert.equal("max_completion_tokens" in body, false);
    const prompt = body.messages.map((message) => message.content).join("\n");
    assert.match(prompt, /\/no_think/);
    assert.match(prompt, /Edited fixture question/);
    assert.match(prompt, /room to run/);
    assert.equal(prompt.includes("semiconductor demand"), false);
    assert.match(output, /not provider-reported usage/);
    assert.match(output, /prompt_tokens=11/);
    assert.match(output, /b3 2026-09-15T16:00:00.000Z excluded \(repost\)/);
    const estimateAt = output.indexOf("Pessimistic estimate");
    const usageAt = output.indexOf("Provider usage");
    assert.ok(estimateAt >= 0 && usageAt > estimateAt);
    assert.match(output, /Synthetic fixture test/);
    assert.match(output, /not current real-world research/);
  });

  it("omits a fake credential from a transport exception", async () => {
    const secret = "sk-live-FAKEKEY-SHOULD-NOT-PRINT";
    const recorded = recordingTransport(
      undefined,
      new Error(`connect ECONNRESET authorization ${secret}`),
    );
    let output = "";
    const code = await runLlmFixtureCheck({
      handle: "bullmacro",
      question: question.text,
      referenceDate: "2026-09-22",
      env: liveEnv(),
      transport: recorded.transport,
      write: (text) => {
        output += text;
      },
    });
    assert.equal(code, 1);
    assert.equal(recorded.calls.length, 1);
    assert.match(output, /Chutes request failed before a response/);
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes("Outlook:"), false);
  });

  it("prints provider usage when refusal, cutoff, or citation checks fail", async () => {
    const postsQuestion = question.text;
    const cases: {
      response: { status: number; bodyText: string };
      usage: string;
      failure: RegExp;
    }[] = [
      {
        response: completion("{}", {
          refusal: "no",
          usage: { prompt_tokens: 21, completion_tokens: 4, total_tokens: 25 },
        }),
        usage: "prompt_tokens=21",
        failure: /Chutes refused the request/,
      },
      {
        response: completion("{", {
          finish_reason: "length",
          usage: { prompt_tokens: 30, completion_tokens: 800, total_tokens: 830 },
        }),
        usage: "prompt_tokens=30",
        failure: /max_tokens was exhausted/,
      },
      {
        response: completion(classifiedOutlook({
          outlook: "bullish",
          explanation: "Should not become a report.",
          posts: [{ postId: "missing", relevant: true, asset_class: "macro", stance: "bullish" }],
        }), { usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 } }),
        usage: "prompt_tokens=12",
        failure: /Citation id missing/,
      },
      {
        response: completion("not-json", {
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        }),
        usage: "prompt_tokens=8",
        failure: /Model content was not JSON/,
      },
    ];

    for (const item of cases) {
      const recorded = recordingTransport(item.response);
      let output = "";
      const code = await runLlmFixtureCheck({
        handle: "bullmacro",
        question: postsQuestion,
        referenceDate: "2026-09-22",
        env: liveEnv(),
        transport: recorded.transport,
        write: (text) => {
          output += text;
        },
      });
      assert.equal(code, 1);
      assert.equal(recorded.calls.length, 1);
      assert.match(output, item.failure);
      assert.match(output, new RegExp(item.usage));
      assert.equal(output.includes("Outlook:"), false);
      assert.equal(output.includes("Should not become a report."), false);
    }
  });

  it("rejects an invalid reference date before any request", async () => {
    const recorded = recordingTransport();
    let output = "";
    const code = await runLlmFixtureCheck({
      handle: "bullmacro",
      question: question.text,
      referenceDate: "2026-02-31",
      env: liveEnv(),
      transport: recorded.transport,
      write: (text) => {
        output += text;
      },
    });
    assert.equal(code, 1);
    assert.equal(recorded.calls.length, 0);
    assert.match(output, /YYYY-MM-DD/);
  });
});
