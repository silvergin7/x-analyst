import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { planAnalysisInput } from "../src/analyze/analysisInput.js";
import { fitAnalysisInputToContextWindow } from "../src/analyze/fitContextWindow.js";
import { chutesWorstCaseEstimateUsd } from "../src/analyzePreflight.js";
import { modestPreflightPosts } from "../src/analyze/preflightPostShapes.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";
import { withTestChutesModelEnv } from "./support/chutesTestModel.js";
import { testChutesModelPlan } from "./support/testChutesModelPlan.js";

describe("preflight post shapes", () => {
  beforeEach(() => installByteQuarterMockTokenizer());
  afterEach(() => clearMockTokenizer());

  it("uses the run handle as authorHandle on synthetic posts", () => {
    const posts = modestPreflightPosts(4, "LynAldenContact");
    assert.ok(posts.every((post) => post.authorHandle === "LynAldenContact"));
  });

  it("plans all 60 modest posts for one handle without author mismatch", () => {
    const handle = "ClassicDavid3";
    const planned = planAnalysisInput(modestPreflightPosts(60, handle), handle);
    assert.equal(planned.sent.length, 60);
    assert.ok(!planned.records.some((record) => record.reason === "author_mismatch"));
  });

  it("preflight Chutes estimate grows with modest post count for one handle", () => {
    const env = withTestChutesModelEnv({});
    const plan = testChutesModelPlan();
    const onePost = chutesWorstCaseEstimateUsd({
      question: "What is the outlook?",
      referenceDate: "2026-10-10",
      handles: ["bullmacro"],
      maxRetrievedPostsPerHandle: 1,
      env,
      chutesModelPlan: plan,
    });
    const sixtyPosts = chutesWorstCaseEstimateUsd({
      question: "What is the outlook?",
      referenceDate: "2026-10-10",
      handles: ["bullmacro"],
      maxRetrievedPostsPerHandle: 60,
      env,
      chutesModelPlan: plan,
    });
    assert.ok(sixtyPosts > onePost);
    assert.ok(sixtyPosts - onePost > 0.000001);
    const fitted = fitAnalysisInputToContextWindow(
      planAnalysisInput(modestPreflightPosts(60, "bullmacro"), "bullmacro"),
      {
        question: "What is the outlook?",
        referenceDate: "2026-10-10",
        postSource: "desearch",
        env,
      },
    );
    assert.ok(fitted.sent.length > 0);
    assert.ok(fitted.sent.length <= 60);
  });
});
