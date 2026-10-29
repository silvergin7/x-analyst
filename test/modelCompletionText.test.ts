import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_GEMMA_THINKING_BLOCK,
  EMPTY_THINKING_BLOCK,
  stripLeadingEmptyThinkingBlock,
} from "../src/analyze/modelCompletionText.js";
import { LlmOutputError } from "../src/analyze/llmErrors.js";

describe("model completion thinking block", () => {
  it("strips a leading empty Qwen thinking block", () => {
    const json = '{"outlook":"unclear"}';
    const raw = `${EMPTY_THINKING_BLOCK}${json}`;
    assert.equal(stripLeadingEmptyThinkingBlock(raw), json);
  });

  it("strips a leading empty Gemma thinking block", () => {
    const json = '{"outlook":"unclear"}';
    const raw = `${EMPTY_GEMMA_THINKING_BLOCK}${json}`;
    assert.equal(stripLeadingEmptyThinkingBlock(raw), json);
  });

  it("parses JSON after a non-empty leading thinking block", () => {
    const open = "<" + "think>";
    const close = "<" + "/think>";
    const json = '{"outlook":"unclear"}';
    const raw = `${open}The model reasoned here.${close}${json}`;
    assert.equal(stripLeadingEmptyThinkingBlock(raw), json);
  });

  it("leaves content unchanged when no thinking block is present", () => {
    const json = '{"outlook":"unclear"}';
    assert.equal(stripLeadingEmptyThinkingBlock(json), json);
  });

  it("does not strip a thinking block that is not leading", () => {
    const json = '{"outlook":"unclear"}';
    const raw = `${json}${EMPTY_THINKING_BLOCK}`;
    assert.equal(stripLeadingEmptyThinkingBlock(raw), raw);
  });

  it("fails on an unclosed Qwen thinking block", () => {
    assert.throws(
      () => stripLeadingEmptyThinkingBlock(`   ${"<" + "think>"}still thinking`),
      LlmOutputError,
    );
  });

  it("fails on an unclosed Gemma thinking block", () => {
    assert.throws(
      () => stripLeadingEmptyThinkingBlock("<|channel>thought   "),
      LlmOutputError,
    );
  });
});
