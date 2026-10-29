import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { buildChutesRequestBody, buildChatMessages } from "../src/analyze/llmPrompt.js";
import { classificationOutputTokenCeiling } from "../src/analyze/outputBudget.js";
import { clearTokenizerRuntimeCacheForTests } from "../src/analyze/tokenizerRuntime.js";
import { countRequestInputTokens } from "../src/analyze/tokenBudget.js";
import { chutesRequestMaxTokens } from "../src/config/llmSettings.js";
import { TEST_CHUTES_MODEL_ID, withTestChutesModelEnv } from "./support/chutesTestModel.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";

describe("run env for token counting", () => {
  afterEach(() => {
    clearMockTokenizer();
    clearTokenizerRuntimeCacheForTests();
  });

  it("uses the run env tokenizer path instead of process.env defaults", () => {
    installByteQuarterMockTokenizer();
    const runEnv = withTestChutesModelEnv({
      CHUTES_TOKENIZER_JSON_PATH: "/tmp/missing-tokenizer.json",
    });
    const body = buildChutesRequestBody(
      buildChatMessages("Q?", [], "2026-10-10", "fixtures"),
      TEST_CHUTES_MODEL_ID,
      chutesRequestMaxTokens(classificationOutputTokenCeiling(1, runEnv)),
      ["p1"],
    );
    assert.doesNotThrow(() => countRequestInputTokens(body, runEnv));
  });
});
