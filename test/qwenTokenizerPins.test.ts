import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_VENDOR_TOKENIZER_DIR,
  PINNED_TOKENIZER_CONFIG,
  PINNED_TOKENIZER_JSON,
  TokenizerPinError,
  readPinnedTokenizerJson,
  resolveTokenizerDirectory,
  verifyPinnedTokenizerFiles,
} from "../src/analyze/qwenTokenizerPins.js";
import { clearMockTokenizer } from "./support/mockQwenTokenizer.js";

const vendorReady =
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer.json`) &&
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer_config.json`);

describe("qwen tokenizer pins", () => {
  it("accepts the vendor tree when checksums match", { skip: !vendorReady }, () => {
    verifyPinnedTokenizerFiles(DEFAULT_VENDOR_TOKENIZER_DIR);
    readPinnedTokenizerJson(DEFAULT_VENDOR_TOKENIZER_DIR);
  });

  it("rejects an override directory with wrong checksums", () => {
    clearMockTokenizer();
    const dir = mkdtempSync(path.join(tmpdir(), "bad-tokenizer-"));
    writeFileSync(path.join(dir, "tokenizer.json"), "{}");
    writeFileSync(path.join(dir, "tokenizer_config.json"), "{}");
    assert.throws(
      () => resolveTokenizerDirectory({ LLM_TOKENIZER_DIR: dir }),
      TokenizerPinError,
    );
  });

  it("mutation: wrong byte size fails verification", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "size-tokenizer-"));
    writeFileSync(path.join(dir, "tokenizer.json"), Buffer.alloc(PINNED_TOKENIZER_JSON.bytes - 1));
    writeFileSync(
      path.join(dir, "tokenizer_config.json"),
      Buffer.alloc(PINNED_TOKENIZER_CONFIG.bytes),
    );
    assert.throws(() => verifyPinnedTokenizerFiles(dir), TokenizerPinError);
  });
});
