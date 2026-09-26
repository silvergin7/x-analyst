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
});
