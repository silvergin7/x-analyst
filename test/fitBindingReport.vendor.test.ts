import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { reportFitShape } from "../src/analyze/fitBindingReport.js";
import { DEFAULT_VENDOR_TOKENIZER_DIR } from "../src/analyze/qwenTokenizerPins.js";
import type { Post } from "../src/types.js";

const vendorReady =
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer.json`) &&
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer_config.json`);

const question = "What is each analyst's current market outlook?";
const referenceDate = "2026-10-10";
const modestText = "Risk assets can still reprice if growth cools from here.";

function modestPosts(count: number): Post[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `modest-${index}`,
    authorHandle: "analyst",
    kind: "original" as const,
    text: modestText,
    timestamp: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    url: `https://fixture.x-analyst.local/posts/analyst/modest-${index}`,
  }));
}

function worstPosts(count: number): Post[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `worst-${index}`,
    authorHandle: "analyst",
    kind: "quote" as const,
    text: "",
    analystComment: "x".repeat(1000),
    quotedPostText: "q".repeat(500),
    timestamp: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    url: `https://fixture.x-analyst.local/posts/analyst/worst-${index}`,
  }));
}

describe("fit binding report with vendor tokenizer", () => {
  for (const count of [31, 48, 55] as const) {
    it(`records modest ${count} post shape`, { skip: !vendorReady }, () => {
      const report = reportFitShape({
        posts: modestPosts(count),
        handle: "analyst",
        question,
        referenceDate,
        env: process.env,
      });
      assert.equal(report.postCount, count);
      assert.equal(report.postsSent, count);
      assert.equal(report.bindingLimit, "none");
      assert.ok(report.inputTokensUpper > 0);
      assert.ok(report.outputTokenCeiling > report.outputJsonByteCeiling);
    });

    it(`records worst ${count} post shape`, { skip: !vendorReady }, () => {
      const report = reportFitShape({
        posts: worstPosts(count),
        handle: "analyst",
        question,
        referenceDate,
        env: process.env,
      });
      assert.equal(report.postCount, count);
      assert.equal(report.bindingLimit, "LLM_INPUT_MAX_CHARS");
      assert.ok(report.postsSent < count);
    });
  }
});
