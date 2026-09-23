import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatFetchIssue,
  formatPersonReport,
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
});
