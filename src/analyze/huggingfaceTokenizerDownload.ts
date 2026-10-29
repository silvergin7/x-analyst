import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import {
  assertSafeHfCommit,
  assertSafeHfRoot,
  resolveTokenizerCacheDir,
} from "./huggingfaceTokenizerPaths.js";
import { BoundedBodyTooLargeError, readResponseBodyWithCap } from "./boundedHttpRead.js";
import { HF_MAX_REDIRECTS, validateRedirectUrl } from "./huggingfaceRedirect.js";

export const HF_TOKENIZER_MAX_BYTES = 100 * 1024 * 1024;
export const HF_TOKENIZER_TIMEOUT_MS = 60_000;

export interface HuggingFaceDownloadTransport {
  get(url: string, signal: AbortSignal): Promise<{ status: number; body: Buffer }>;
}

export interface TokenizerCacheMeta {
  root: string;
  commit: string;
  sha256: string;
}

export interface LoadedTokenizerCache {
  tokenizerJsonPath: string;
  meta: TokenizerCacheMeta;
}

function sha256Buffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function metaPath(cacheDir: string): string {
  return path.join(cacheDir, "meta.json");
}

function readMeta(cacheDir: string): TokenizerCacheMeta | null {
  try {
    const parsed = JSON.parse(readFileSync(metaPath(cacheDir), "utf8")) as TokenizerCacheMeta;
    if (
      typeof parsed.root !== "string" ||
      typeof parsed.commit !== "string" ||
      typeof parsed.sha256 !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeMeta(cacheDir: string, meta: TokenizerCacheMeta): void {
  const temp = `${metaPath(cacheDir)}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  renameSync(temp, metaPath(cacheDir));
}

export function createFetchHfDownloadTransport(): HuggingFaceDownloadTransport {
  return {
    async get(url, signal) {
      let current = new URL(url);
      for (let hop = 0; hop <= HF_MAX_REDIRECTS; hop++) {
        if (current.protocol !== "https:") {
          throw new Error("Hugging Face download must use https");
        }
        const response = await fetch(current.toString(), { method: "GET", signal, redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location === null || location === "") {
            throw new Error("Hugging Face download redirect missing location");
          }
          const next = new URL(location, current);
          validateRedirectUrl(current, next);
          current = next;
          continue;
        }
        const buffer = await readResponseBodyWithCap(response, HF_TOKENIZER_MAX_BYTES);
        return { status: response.status, body: buffer };
      }
      throw new Error("Hugging Face download exceeded redirect limit");
    },
  };
}

async function downloadTokenizerBytes(
  root: string,
  commit: string,
  transport: HuggingFaceDownloadTransport,
): Promise<Buffer> {
  assertSafeHfRoot(root);
  assertSafeHfCommit(commit);
  const url = `https://huggingface.co/${root}/resolve/${commit}/tokenizer.json`;
  const signal = AbortSignal.timeout(HF_TOKENIZER_TIMEOUT_MS);
  const response = await transport.get(url, signal);
  if (response.status !== 200) {
    throw new Error(`Hugging Face tokenizer download returned HTTP ${response.status}`);
  }
  if (response.body.byteLength > HF_TOKENIZER_MAX_BYTES) {
    throw new Error("Hugging Face tokenizer download exceeded the size cap");
  }
  return response.body;
}

export async function loadTokenizerCache(
  root: string,
  commit: string,
  env: NodeJS.ProcessEnv,
  transport: HuggingFaceDownloadTransport,
): Promise<LoadedTokenizerCache> {
  const cacheDir = resolveTokenizerCacheDir(root, commit, env);
  mkdirSync(cacheDir, { recursive: true });
  const jsonPath = path.join(cacheDir, "tokenizer.json");
  const existingMeta = readMeta(cacheDir);
  if (existingMeta !== null && existingMeta.root === root && existingMeta.commit === commit) {
    try {
      const body = readFileSync(jsonPath);
      const sha256 = sha256Buffer(body);
      if (sha256 === existingMeta.sha256) {
        return { tokenizerJsonPath: jsonPath, meta: existingMeta };
      }
    } catch {
      /* re-download */
    }
    const redownloaded = await downloadTokenizerBytes(root, commit, transport);
    const sha256 = sha256Buffer(redownloaded);
    if (sha256 !== existingMeta.sha256) {
      throw new Error("Hugging Face tokenizer checksum mismatch after re-download");
    }
    writeFileSync(jsonPath, redownloaded);
    return { tokenizerJsonPath: jsonPath, meta: existingMeta };
  }

  const body = await downloadTokenizerBytes(root, commit, transport);
  const sha256 = sha256Buffer(body);
  const temp = `${jsonPath}.tmp-${process.pid}`;
  writeFileSync(temp, body);
  renameSync(temp, jsonPath);
  const meta = { root, commit, sha256 };
  writeMeta(cacheDir, meta);
  return { tokenizerJsonPath: jsonPath, meta };
}
