import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LLM_CONTEXT_SAFETY_MARGIN_TOKENS,
  fitsModelContextWindow,
} from "../src/config/llmSettings.js";

describe("fitsModelContextWindow", () => {
  it("mutation: rejects input plus max_tokens above the window budget", () => {
    const maxTokens = 800;
    const contextLengthTokens = 40_960;
    const budget = contextLengthTokens - LLM_CONTEXT_SAFETY_MARGIN_TOKENS;
    assert.equal(fitsModelContextWindow(contextLengthTokens, budget - maxTokens, maxTokens), true);
    assert.equal(fitsModelContextWindow(contextLengthTokens, budget - maxTokens + 1, maxTokens), false);
  });
});
