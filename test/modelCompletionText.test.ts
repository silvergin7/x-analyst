import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_THINKING_BLOCK,
  stripLeadingEmptyThinkingBlock,
} from "../src/analyze/modelCompletionText.js";
import { LlmOutputError } from "../src/analyze/llmErrors.js";

describe("model completion thinking block", () => {
  it("strips a leading empty thinking block", () => {
    const json = '{"outlook":"unclear"}';
    const raw = `${EMPTY_THINKING_BLOCK}${json}`;
    assert.equal(stripLeadingEmptyThinkingBlock(raw), json);
  });

  it("fails when thinking content is not whitespace-only", () => {
    const raw = "<think>secret</think>{\"outlook\":\"unclear\"}";
    assert.throws(() => stripLeadingEmptyThinkingBlock(raw), LlmOutputError);
  });

  it("leaves content unchanged when no thinking block is present", () => {
    const json = '{"outlook":"unclear"}';
    assert.equal(stripLeadingEmptyThinkingBlock(json), json);
  });
});
