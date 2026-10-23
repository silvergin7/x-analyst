import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { chutesWorstCaseEstimateUsd } from "../src/analyzePreflight.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";

describe("analyze preflight Chutes estimate", () => {
  beforeEach(() => installByteQuarterMockTokenizer());
  afterEach(() => clearMockTokenizer());

  it("uses the larger of modest and long post shapes at max retrieved count", () => {
    const env: NodeJS.ProcessEnv = {};
    const modestOnly = chutesWorstCaseEstimateUsd({
      question: "What is the outlook?",
      referenceDate: "2026-10-10",
      handles: ["analyst"],
      maxRetrievedPostsPerHandle: 3,
      env,
    });
    assert.ok(modestOnly > 0);
    const withLongShape = chutesWorstCaseEstimateUsd({
      question: "What is the outlook?",
      referenceDate: "2026-10-10",
      handles: ["analyst"],
      maxRetrievedPostsPerHandle: 55,
      env,
    });
    assert.ok(withLongShape >= modestOnly);
  });
});
