import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { buildChutesRequestBody, buildChatMessages } from "../src/analyze/llmPrompt.js";
import { classificationOutputTokenCeiling } from "../src/analyze/outputBudget.js";
import { clearQwenTokenizerRuntimeCacheForTests, getQwenTokenizerRuntime } from "../src/analyze/qwenTokenizerRuntime.js";
import { countRequestInputTokens } from "../src/analyze/tokenBudget.js";
import { PRICED_LLM_MODEL } from "../src/config/llmSettings.js";
import { DEFAULT_VENDOR_TOKENIZER_DIR } from "../src/analyze/qwenTokenizerPins.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";
import { existsSync } from "node:fs";

describe("run env for token counting", () => {
  afterEach(() => {
    clearMockTokenizer();
    clearQwenTokenizerRuntimeCacheForTests();
  });

  it("uses the run env tokenizer directory instead of process.env", () => {
    clearMockTokenizer();
    clearQwenTokenizerRuntimeCacheForTests();
    if (!existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer.json`)) {
      installByteQuarterMockTokenizer();
      const body = buildChutesRequestBody(
        buildChatMessages("Q?", [], "2026-10-10", "fixtures"),
        PRICED_LLM_MODEL,
        classificationOutputTokenCeiling(1, process.env),
        ["p1"],
      );
      assert.doesNotThrow(() => countRequestInputTokens(body, process.env));
      return;
    }
    const saved = process.env.LLM_TOKENIZER_DIR;
    process.env.LLM_TOKENIZER_DIR = DEFAULT_VENDOR_TOKENIZER_DIR;
    const runEnv: NodeJS.ProcessEnv = {
      ...process.env,
      LLM_TOKENIZER_DIR: "/tmp/x-analyst-missing-tokenizer-dir",
    };
    const maxTokens = classificationOutputTokenCeiling(1, process.env);
    const body = buildChutesRequestBody(
      buildChatMessages("Q?", [], "2026-10-10", "fixtures"),
      PRICED_LLM_MODEL,
      maxTokens,
      ["p1"],
    );
    assert.doesNotThrow(() => countRequestInputTokens(body, process.env));
    assert.throws(() => countRequestInputTokens(body, runEnv));
    assert.doesNotThrow(() => getQwenTokenizerRuntime(process.env));
    if (saved === undefined) delete process.env.LLM_TOKENIZER_DIR;
    else process.env.LLM_TOKENIZER_DIR = saved;
  });
});
