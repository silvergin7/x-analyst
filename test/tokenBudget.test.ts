import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { buildChatMessages, buildChutesRequestBody } from "../src/analyze/llmPrompt.js";
import {
  calibrationMarginTokens,
  countRequestInputTokens,
} from "../src/analyze/tokenBudget.js";
import {
  LLM_TOKENIZER_CALIBRATION_FIXED,
  LLM_TOKENIZER_CALIBRATION_RATIO,
  PRICED_LLM_MODEL,
} from "../src/config/llmSettings.js";
import { classificationOutputTokenCeiling } from "../src/analyze/outputBudget.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";

describe("token budget", () => {
  beforeEach(() => installByteQuarterMockTokenizer());
  afterEach(() => clearMockTokenizer());

  it("counts response_format tokens separately from chat messages", () => {
    const sent = [
      {
        post: {
          id: "p1",
          authorHandle: "analyst",
          kind: "original" as const,
          text: "x".repeat(4000),
          timestamp: "2026-10-10T00:00:00.000Z",
          url: "https://fixture.x-analyst.local/p1",
        },
        text: "x".repeat(4000),
        originalChars: 4000,
        truncated: false,
      },
    ];
    const body = buildChutesRequestBody(
      buildChatMessages("Question?", sent, "2026-10-10", "desearch"),
      PRICED_LLM_MODEL,
      classificationOutputTokenCeiling(1, process.env),
      ["p1"],
    );
    const counted = countRequestInputTokens(body, process.env);
    assert.ok(counted.responseFormatTokens > 0);
    assert.ok(counted.messageTokens > counted.responseFormatTokens);
    assert.equal(
      counted.calibrationMarginTokens,
      calibrationMarginTokens(counted.messageTokens),
    );
    assert.ok(counted.inputTokensUpper > counted.messageTokens);
  });

  it("mutation: inputTokensUpper includes response_format tokens", () => {
    const body = buildChutesRequestBody(
      buildChatMessages("Q?", [], "2026-10-10", "desearch"),
      PRICED_LLM_MODEL,
      classificationOutputTokenCeiling(0, process.env),
      [],
    );
    const counted = countRequestInputTokens(body, process.env);
    assert.ok(counted.responseFormatTokens > 0);
    assert.equal(
      counted.inputTokensUpper,
      counted.messageTokens + counted.responseFormatTokens + counted.calibrationMarginTokens,
    );
  });

  it("mutation: calibration margin uses the fixed floor", () => {
    assert.equal(calibrationMarginTokens(1), LLM_TOKENIZER_CALIBRATION_FIXED);
  });

  it("mutation: calibration margin scales with message tokens", () => {
    const messageTokens = 10_000;
    assert.equal(
      calibrationMarginTokens(messageTokens),
      Math.max(
        LLM_TOKENIZER_CALIBRATION_FIXED,
        Math.ceil(messageTokens * LLM_TOKENIZER_CALIBRATION_RATIO),
      ),
    );
  });
});
