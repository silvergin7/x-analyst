import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { isAllowedHfDownloadHost } from "../src/analyze/huggingfaceRedirect.js";
import {
  loadTokenizerCache,
  type HuggingFaceDownloadTransport,
} from "../src/analyze/huggingfaceTokenizerDownload.js";

describe("Hugging Face tokenizer cache", () => {
  it("mutation: rejects evil redirect hosts", () => {
    assert.equal(isAllowedHfDownloadHost("huggingface.co"), true);
    assert.equal(isAllowedHfDownloadHost("us.aws.cdn.hf.co"), true);
    assert.equal(isAllowedHfDownloadHost("hf.co.evil.com"), false);
    assert.equal(isAllowedHfDownloadHost("huggingface.co.evil.com"), false);
  });

  it("uses cache when sha256 matches meta.json", async () => {
    const env: NodeJS.ProcessEnv = {
      X_ANALYST_TOKENIZER_CACHE_DIR: mkdtempSync(path.join(tmpdir(), "tok-cache-")),
    };
    const transport: HuggingFaceDownloadTransport = {
      async get() {
        throw new Error("network should not be used on cache hit");
      },
    };
    const root = "org/model";
    const commit = "a".repeat(40);
    const body = Buffer.from('{"version":"1.0"}');
    const dir = path.join(env.X_ANALYST_TOKENIZER_CACHE_DIR!, `${root}@${commit}`);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "tokenizer.json"), body);
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(body).digest("hex");
    writeFileSync(
      path.join(dir, "meta.json"),
      `${JSON.stringify({ root, commit, sha256 }, null, 2)}\n`,
    );
    const loaded = await loadTokenizerCache(root, commit, env, transport);
    assert.equal(loaded.meta.sha256, sha256);
    assert.equal(readFileSync(loaded.tokenizerJsonPath).toString(), body.toString());
  });

  it("re-downloads once when cached sha256 mismatches, then fails if still wrong", async () => {
    const env: NodeJS.ProcessEnv = {
      X_ANALYST_TOKENIZER_CACHE_DIR: mkdtempSync(path.join(tmpdir(), "tok-cache-")),
    };
    const root = "org/model";
    const commit = "c".repeat(40);
    const dir = path.join(env.X_ANALYST_TOKENIZER_CACHE_DIR!, `${root}@${commit}`);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    const stale = Buffer.from('{"version":"stale"}');
    writeFileSync(path.join(dir, "tokenizer.json"), stale);
    const { createHash } = await import("node:crypto");
    const good = Buffer.from('{"version":"good"}');
    const goodSha = createHash("sha256").update(good).digest("hex");
    writeFileSync(
      path.join(dir, "meta.json"),
      `${JSON.stringify({ root, commit, sha256: goodSha }, null, 2)}\n`,
    );
    let downloads = 0;
    const transport: HuggingFaceDownloadTransport = {
      async get() {
        downloads += 1;
        return { status: 200, body: good };
      },
    };
    const loaded = await loadTokenizerCache(root, commit, env, transport);
    assert.equal(downloads, 1);
    assert.equal(loaded.meta.sha256, goodSha);

    writeFileSync(path.join(dir, "tokenizer.json"), stale);
    const transportBad: HuggingFaceDownloadTransport = {
      async get() {
        return { status: 200, body: stale };
      },
    };
    await assert.rejects(
      () => loadTokenizerCache(root, commit, env, transportBad),
      /checksum mismatch/,
    );
  });
});
