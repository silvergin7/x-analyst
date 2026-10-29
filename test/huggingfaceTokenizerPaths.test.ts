import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeHfCommit,
  assertSafeHfRoot,
  resolveTokenizerCacheDir,
} from "../src/analyze/huggingfaceTokenizerPaths.js";
import { validateRedirectUrl } from "../src/analyze/huggingfaceRedirect.js";

describe("Hugging Face tokenizer path safety", () => {
  it("accepts a safe model root and commit", () => {
    assert.doesNotThrow(() => assertSafeHfRoot("org/model-name"));
    assert.doesNotThrow(() => assertSafeHfCommit("a".repeat(40)));
  });

  it("rejects unsafe model roots", () => {
    assert.throws(() => assertSafeHfRoot("../evil/model"));
    assert.throws(() => assertSafeHfRoot("org/../model"));
    assert.throws(() => assertSafeHfRoot("bad"));
  });

  it("rejects unsafe commits", () => {
    assert.throws(() => assertSafeHfCommit("G".repeat(40)));
    assert.throws(() => assertSafeHfCommit("abc"));
  });

  it("keeps resolved cache paths inside the cache root", () => {
    const dir = resolveTokenizerCacheDir("org/model", "b".repeat(40), {
      X_ANALYST_TOKENIZER_CACHE_DIR: "/tmp/x-analyst-tokenizers",
    });
    assert.ok(dir.startsWith("/tmp/x-analyst-tokenizers/"));
  });

  it("mutation: refuses http redirect targets", () => {
    const from = new URL("https://huggingface.co/org/model/resolve/main/tokenizer.json");
    const to = new URL("http://huggingface.co/evil");
    assert.throws(() => validateRedirectUrl(from, to));
  });
});
