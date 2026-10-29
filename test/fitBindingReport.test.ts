import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { reportFitShape } from "../src/analyze/fitBindingReport.js";
import type { Post } from "../src/types.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";
import { withTestChutesModelEnv } from "./support/chutesTestModel.js";

const question = "What is each analyst's current market outlook?";
const referenceDate = "2026-10-10";

function modestPosts(count: number): Post[] {
  const text = "Risk assets can still reprice if growth cools from here.";
  return Array.from({ length: count }, (_, index) => ({
    id: `modest-${index}`,
    authorHandle: "analyst",
    kind: "original" as const,
    text,
    timestamp: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    url: `https://fixture.x-analyst.local/posts/analyst/modest-${index}`,
  }));
}

describe("fit binding report", () => {
  beforeEach(() => {
    installByteQuarterMockTokenizer();
    withTestChutesModelEnv(process.env);
  });
  afterEach(() => clearMockTokenizer());

  it("records none when every post is sent and the context window fits", () => {
    const report = reportFitShape({
      posts: modestPosts(12),
      handle: "analyst",
      question,
      referenceDate,
      env: withTestChutesModelEnv(process.env),
    });
    assert.equal(report.postsSent, 12);
    assert.equal(report.bindingLimit, "none");
  });
});
