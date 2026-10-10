import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatFetchIssue,
  formatFullReport,
  formatPersonReport,
  formatReportFailure,
} from "../../src/format/report.js";
import type { FetchOutcome, PersonOutlookReport } from "../../src/types.js";

describe("formatFetchIssue", () => {
  it("describes total-limit exhaustion without an outlook", () => {
    const outcome: FetchOutcome = {
      status: "incomplete",
      handle: "bearmacro",
      reason: "total_post_limit_reached",
    };
    const line = formatFetchIssue(outcome);
    assert.match(line, /Incomplete retrieval for "@bearmacro"/);
    assert.match(line, /total_post_limit_reached/);
    assert.match(line, /not examined/);
  });

  it("describes partial retrieval when per-person limit applies", () => {
    const outcome: FetchOutcome = {
      status: "ok",
      handle: "bullmacro",
      posts: [
        {
          id: "b1",
          authorHandle: "bullmacro",
          text: "x",
          timestamp: "2026-09-20T14:00:00.000Z",
          url: "https://fixture.x-analyst.local/posts/bullmacro/b1",
          kind: "original",
        },
        {
          id: "b2",
          authorHandle: "bullmacro",
          text: "y",
          timestamp: "2026-09-18T09:30:00.000Z",
          url: "https://fixture.x-analyst.local/posts/bullmacro/b2",
          kind: "original",
        },
      ],
      retrievalComplete: false,
      incompleteReason: "per_person_limit_reached",
    };
    const line = formatFetchIssue(outcome);
    assert.match(line, /Partial retrieval for "@bullmacro"/);
    assert.match(line, /per-person post limit/);
    assert.match(line, /2 post\(s\) retrieved/);
  });
});

describe("formatPersonReport", () => {
  it("shows incomplete coverage on the person report", () => {
    const report: PersonOutlookReport = {
      handle: "bearmacro",
      outlook: "bearish",
      explanation: "Mock analysis example.",
      dateRangeExamined: null,
      postsExamined: 1,
      retrievalComplete: false,
      retrievalIncompleteReason: "total_post_limit_reached",
      evidence: [],
      analysisSource: "mock",
    };
    const text = formatPersonReport(report);
    assert.match(text, /Coverage: incomplete \(configured total post limit/);
  });

  it("prints llm usage separately from a mock-rules line", () => {
    const report: PersonOutlookReport = {
      handle: "bullmacro",
      outlook: "bullish",
      explanation: "The supplied text is constructive.",
      dateRangeExamined: {
        from: "2026-09-18T00:00:00.000Z",
        to: "2026-09-20T00:00:00.000Z",
      },
      postsExamined: 1,
      retrievalComplete: true,
      evidence: [],
      analysisSource: "llm",
      modelInvoked: true,
      providerUsage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
      analysisInput: [
        {
          postId: "b3",
          timestamp: "2026-09-19T00:00:00.000Z",
          disposition: "excluded",
          reason: "repost",
          originalChars: 12,
          sentChars: 0,
        },
      ],
    };
    const text = formatPersonReport(report);
    assert.match(text, /source: llm, model invoked: yes/);
    assert.match(text, /prompt_tokens=4/);
    assert.match(text, /b3 2026-09-19T00:00:00.000Z excluded/);
    assert.doesNotMatch(text, /not LLM/);
  });
});

describe("formatFullReport source labels", () => {
  it("does not call retrieved Desearch posts a synthetic fixture", () => {
    const text = formatFullReport("Question?", [], [], {
      postsSource: "desearch",
      analysisSource: "chutes",
      referenceDate: "2026-10-09",
      fetchedAt: "2026-10-09T12:00:00.000Z",
      reused: true,
      billing: [{ usageCount: 2 }],
    });
    assert.match(text, /Posts source: desearch/);
    assert.match(text, /Slice: reused/);
    assert.match(text, /Fetched at: 2026-10-09T12:00:00.000Z/);
    assert.match(text, /usage_count=2/);
    assert.doesNotMatch(text, /synthetic fixture/);
    assert.doesNotMatch(text, /Fictional/);
    assert.doesNotMatch(text, /cost_usd/);
  });
});

describe("formatReportFailure", () => {
  it("prints earlier usage and billing with the failure and no complete report", () => {
    const text = formatReportFailure("Chutes refused the request", {
      postsSource: "desearch",
      analysisSource: "chutes",
      referenceDate: "2026-11-02",
      fetchedAt: "2026-11-02T12:00:00.000Z",
      reused: false,
      sliceStored: true,
      billing: [{ usageCount: 3 }, { usageCount: 4 }],
      providerUsages: [
        { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
        { promptTokens: 9, completionTokens: 1, totalTokens: 10 },
      ],
    });
    assert.match(text, /The run failed/);
    assert.match(text, /No complete report was produced/);
    assert.match(text, /prompt_tokens=11/);
    assert.match(text, /prompt_tokens=9/);
    assert.match(text, /usage_count=3/);
    assert.match(text, /usage_count=4/);
    assert.match(text, /Slice: fetched/);
    assert.doesNotMatch(text, /Per-analyst outlook/);
  });
});
