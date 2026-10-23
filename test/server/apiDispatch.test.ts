import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMetaResponse,
  dispatchApiForTest,
} from "../../server/apiDispatch.js";

describe("GET /api/meta", () => {
  it("returns explicit mock demo metadata", async () => {
    const { statusCode, body } = await dispatchApiForTest({
      method: "GET",
      pathname: "/api/meta",
    });
    assert.equal(statusCode, 200);
    const json = JSON.parse(body) as ReturnType<typeof buildMetaResponse>;
    assert.equal(json.mode, "mock");
    assert.equal(json.demo, true);
    assert.equal(json.liveApiEnabled, false);
    assert.equal(json.postsSource, "fixtures");
    assert.equal(json.analysisSource, "mock-rules");
  });
});

describe("POST /api/analyze", () => {
  it("returns mock mode, reports, and fixture evidence URLs on happy path", async () => {
    const { statusCode, body } = await dispatchApiForTest({
      method: "POST",
      pathname: "/api/analyze",
      body: JSON.stringify({
        handles: "bullmacro",
        question: "What is the outlook?",
      }),
    });
    assert.equal(statusCode, 200);
    const json = JSON.parse(body) as {
      mode: string;
      reports: { evidence: { url: string }[] }[];
    };
    assert.equal(json.mode, "mock");
    assert.ok(json.reports.length >= 1);
    const urls = json.reports.flatMap((r) => r.evidence.map((e) => e.url));
    assert.ok(urls.length >= 1);
    assert.ok(
      urls.every((u) => u.includes("fixture.x-analyst.local")),
      "evidence must use fixture URLs",
    );
  });

  it("returns invalid handles while still analyzing valid ones", async () => {
    const { statusCode, body } = await dispatchApiForTest({
      method: "POST",
      pathname: "/api/analyze",
      body: JSON.stringify({
        handles: "!!!invalid!!!, bullmacro",
        question: "Outlook?",
      }),
    });
    assert.equal(statusCode, 200);
    const json = JSON.parse(body) as {
      invalidHandles: { raw: string }[];
      reports: { handle: string }[];
    };
    assert.ok(json.invalidHandles.length >= 1);
    assert.ok(json.reports.some((r) => r.handle === "bullmacro"));
  });

  it("rejects empty question with 400", async () => {
    const { statusCode, body } = await dispatchApiForTest({
      method: "POST",
      pathname: "/api/analyze",
      body: JSON.stringify({
        handles: "bullmacro",
        question: "   ",
      }),
    });
    assert.equal(statusCode, 400);
    const json = JSON.parse(body) as { error: string };
    assert.match(json.error, /question/i);
    assert.equal("stack" in json, false);
  });

  it("rejects when no valid handles with 400", async () => {
    const { statusCode, body } = await dispatchApiForTest({
      method: "POST",
      pathname: "/api/analyze",
      body: JSON.stringify({
        handles: "!!!, @@@@",
        question: "Outlook?",
      }),
    });
    assert.equal(statusCode, 400);
    const json = JSON.parse(body) as { error: string; invalidHandles?: unknown[] };
    assert.match(json.error, /valid handle/i);
    assert.ok(Array.isArray(json.invalidHandles));
  });

  it("returns fixture labels, a reference date, and a fetched slice on the mock path", async () => {
    const { statusCode, body } = await dispatchApiForTest({
      method: "POST",
      pathname: "/api/analyze",
      body: JSON.stringify({
        handles: "bullmacro",
        question: "What is the outlook?",
      }),
    });
    const json = JSON.parse(body) as {
      postsSource: string;
      analysisSource: string;
      referenceDate: string;
      fetchedAt: string;
      reused: boolean;
      billing: unknown[];
    };
    assert.equal(statusCode, 200);
    assert.equal(json.postsSource, "fixtures");
    assert.equal(json.analysisSource, "mock-rules");
    assert.match(json.referenceDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(json.reused, false);
    assert.ok(json.fetchedAt.length > 0);
    assert.deepEqual(json.billing, []);
  });
});

describe("live gates stay closed until a request is allowed", () => {
  it("labels a fully enabled configuration without calling a transport", () => {
    const meta = buildMetaResponse({
      POSTS_PROVIDER: "desearch",
      DESEARCH_LIVE_ENABLED: "true",
      DESEARCH_API_KEY: "unit-test-only-not-a-secret",
      ANALYSIS_PROVIDER: "chutes",
      LLM_LIVE_ENABLED: "true",
      CHUTES_API_KEY: "unit-test-only-not-a-secret",
      LLM_MODEL: "Qwen/Qwen3-32B-TEE",
    });
    assert.equal(meta.mode, "live");
    assert.equal(meta.demo, false);
    assert.equal(meta.postsSource, "desearch");
    assert.equal(meta.analysisSource, "chutes");
    assert.equal(meta.liveApiEnabled, true);
    assert.match(meta.description, /does not call Desearch or Chutes/);
  });

  it("rejects an over-long question before either transport is called", async () => {
    let desearchCalls = 0;
    let chutesCalls = 0;
    const { statusCode, body } = await dispatchApiForTest({
      method: "POST",
      pathname: "/api/analyze",
      body: JSON.stringify({
        handles: "bullmacro",
        question: "q".repeat(501),
      }),
      env: {
        POSTS_PROVIDER: "desearch",
        DESEARCH_LIVE_ENABLED: "true",
        DESEARCH_API_KEY: "unit-test-only-not-a-secret",
        ANALYSIS_PROVIDER: "chutes",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "unit-test-only-not-a-secret",
        LLM_MODEL: "Qwen/Qwen3-32B-TEE",
        DESEARCH_MAX_REQUESTS_PER_HANDLE: "3",
      },
      desearchTransport: {
        async execute() {
          desearchCalls += 1;
          return { status: 200, body: { tweets: [] } };
        },
      },
      chutesTransport: {
        async post() {
          chutesCalls += 1;
          return { status: 200, bodyText: "{}" };
        },
      },
    });
    assert.equal(statusCode, 400);
    assert.match(JSON.parse(body).error, /No request was sent/);
    assert.equal(desearchCalls, 0);
    assert.equal(chutesCalls, 0);
  });

  it("returns billing on a retrieval failure and omits the provider body", async () => {
    const fakeKey = "sk-live-FAKEKEY-SHOULD-NOT-PRINT";
    let desearchCalls = 0;
    let chutesCalls = 0;
    const { statusCode, body } = await dispatchApiForTest({
      method: "POST",
      pathname: "/api/analyze",
      body: JSON.stringify({
        handles: "bullmacro",
        question: "What is the outlook?",
      }),
      env: {
        POSTS_PROVIDER: "desearch",
        DESEARCH_LIVE_ENABLED: "true",
        DESEARCH_API_KEY: "unit-test-only-not-a-secret",
        DESEARCH_MAX_REQUESTS_PER_RUN: "1",
        DESEARCH_MAX_REQUESTS_PER_HANDLE: "3",
        ANALYSIS_PROVIDER: "chutes",
        LLM_LIVE_ENABLED: "true",
        CHUTES_API_KEY: "unit-test-only-not-a-secret",
        LLM_MODEL: "Qwen/Qwen3-32B-TEE",
      },
      desearchTransport: {
        async execute() {
          desearchCalls += 1;
          return {
            status: 401,
            body: { message: `rejected ${fakeKey}` },
            billing: { usageCount: 6 },
          };
        },
      },
      chutesTransport: {
        async post() {
          chutesCalls += 1;
          return { status: 200, bodyText: "{}" };
        },
      },
    });
    assert.equal(statusCode, 502);
    assert.equal(desearchCalls, 1);
    assert.equal(chutesCalls, 0);
    const json = JSON.parse(body) as {
      error: string;
      billing: { usageCount?: number }[];
      providerUsages: unknown[];
      sliceStored: boolean;
      reports?: unknown;
    };
    assert.match(json.error, /HTTP 401/);
    assert.equal(json.error.includes(fakeKey), false);
    assert.deepEqual(json.billing, [{ usageCount: 6 }]);
    assert.deepEqual(json.providerUsages, []);
    assert.equal(json.sliceStored, false);
    assert.equal(json.reports, undefined);
  });
});
