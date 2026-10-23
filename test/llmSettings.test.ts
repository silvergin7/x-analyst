import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LLM_CONTEXT_SAFETY_MARGIN_TOKENS,
  LLM_CONTEXT_WINDOW_TOKENS,
  fitsModelContextWindow,
} from "../src/config/llmSettings.js";

describe("fitsModelContextWindow", () => {
  it("mutation: rejects input plus max_tokens above the window budget", () => {
    const maxTokens = 800;
    const budget = LLM_CONTEXT_WINDOW_TOKENS - LLM_CONTEXT_SAFETY_MARGIN_TOKENS;
    assert.equal(fitsModelContextWindow(budget - maxTokens, maxTokens), true);
    assert.equal(fitsModelContextWindow(budget - maxTokens + 1, maxTokens), false);
  });
});
