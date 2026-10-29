import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LLM_CONTEXT_SAFETY_MARGIN_TOKENS,
  LLM_THINKING_ALLOWANCE_TOKENS,
  chutesRequestMaxTokens,
  fitsModelContextWindow,
} from "../src/config/llmSettings.js";

describe("fitsModelContextWindow", () => {
  it("mutation: rejects input plus max_tokens above the window budget", () => {
    const outputCeiling = 800;
    const maxTokens = outputCeiling + LLM_THINKING_ALLOWANCE_TOKENS;
    const contextLengthTokens = 40_960;
    const budget = contextLengthTokens - LLM_CONTEXT_SAFETY_MARGIN_TOKENS;
    assert.equal(chutesRequestMaxTokens(outputCeiling), maxTokens);
    assert.equal(fitsModelContextWindow(contextLengthTokens, budget - maxTokens, maxTokens), true);
    assert.equal(fitsModelContextWindow(contextLengthTokens, budget - maxTokens + 1, maxTokens), false);
  });
});
