import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { liveTokenizerPreflightMessage } from "../src/analyze/qwenTokenizerPins.js";

describe("live tokenizer preflight", () => {
  it("returns a preflight error when the vendor tree is absent", () => {
    const missingDir = mkdtempSync(path.join(tmpdir(), "missing-tokenizer-"));
    const message = liveTokenizerPreflightMessage({ LLM_TOKENIZER_DIR: missingDir });
    assert.notEqual(message, null);
    assert.match(message!, /^Preflight error:/);
    assert.match(message!, /Qwen tokenizer files missing/);
  });
});
