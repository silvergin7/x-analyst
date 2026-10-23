import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const QWEN_TOKENIZER_REVISION = "aa55da1ecc13d006e8b8e4f54579b1ea8c3db2df";

export const QWEN_TOKENIZER_MODEL_ID = "Qwen/Qwen3-32B-FP8";

export const PINNED_TOKENIZER_JSON = {
  bytes: 11_422_654,
  sha256: "aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4",
} as const;

export const PINNED_TOKENIZER_CONFIG = {
  bytes: 9_732,
  sha256: "d5d09f07b48c3086c508b30d1c9114bd1189145b74e982a265350c923acd8101",
} as const;

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

export const DEFAULT_VENDOR_TOKENIZER_DIR = path.join(repoRoot, "vendor", "qwen3-32b-fp8");

export class TokenizerPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenizerPinError";
  }
}

function sha256File(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export function liveTokenizerPreflightMessage(env: NodeJS.ProcessEnv): string | null {
  try {
    resolveTokenizerDirectory(env);
    return null;
  } catch (err) {
    if (err instanceof TokenizerPinError) {
      return `Preflight error: ${err.message}`;
    }
    return "Preflight error: pinned Qwen3 tokenizer is not installed or verified";
  }
}

export function qwenTokenizerVendorReady(env: NodeJS.ProcessEnv = process.env): boolean {
  const override = env.LLM_TOKENIZER_DIR?.trim();
  const dir =
    override === "" || override === undefined ? DEFAULT_VENDOR_TOKENIZER_DIR : override;
  return (
    existsSync(path.join(dir, "tokenizer.json")) &&
    existsSync(path.join(dir, "tokenizer_config.json"))
  );
}

export function verifyPinnedTokenizerFiles(dir: string): void {
  const jsonPath = path.join(dir, "tokenizer.json");
  const configPath = path.join(dir, "tokenizer_config.json");
  let jsonHash: string;
  let configHash: string;
  try {
    jsonHash = sha256File(jsonPath);
    configHash = sha256File(configPath);
  } catch {
    throw new TokenizerPinError(
      `Qwen tokenizer files missing under ${dir}. Install ${QWEN_TOKENIZER_MODEL_ID} at revision ${QWEN_TOKENIZER_REVISION}.`,
    );
  }
  const jsonStat = readFileSync(jsonPath);
  if (jsonStat.byteLength !== PINNED_TOKENIZER_JSON.bytes) {
    throw new TokenizerPinError(
      `tokenizer.json size ${jsonStat.byteLength} does not match pinned ${PINNED_TOKENIZER_JSON.bytes} bytes`,
    );
  }
  if (jsonHash !== PINNED_TOKENIZER_JSON.sha256) {
    throw new TokenizerPinError("tokenizer.json SHA-256 does not match the pinned checksum");
  }
  const configStat = readFileSync(configPath);
  if (configStat.byteLength !== PINNED_TOKENIZER_CONFIG.bytes) {
    throw new TokenizerPinError(
      `tokenizer_config.json size ${configStat.byteLength} does not match pinned ${PINNED_TOKENIZER_CONFIG.bytes} bytes`,
    );
  }
  if (configHash !== PINNED_TOKENIZER_CONFIG.sha256) {
    throw new TokenizerPinError("tokenizer_config.json SHA-256 does not match the pinned checksum");
  }
}

export function resolveTokenizerDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.LLM_TOKENIZER_DIR?.trim();
  const dir = override === "" || override === undefined ? DEFAULT_VENDOR_TOKENIZER_DIR : override;
  verifyPinnedTokenizerFiles(dir);
  return dir;
}

export function readPinnedTokenizerJson(dir: string): {
  tokenizer: Record<string, unknown>;
  config: Record<string, unknown> & { chat_template?: string };
} {
  verifyPinnedTokenizerFiles(dir);
  const tokenizer = JSON.parse(readFileSync(path.join(dir, "tokenizer.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const config = JSON.parse(readFileSync(path.join(dir, "tokenizer_config.json"), "utf8")) as Record<
    string,
    unknown
  > & { chat_template?: string };
  return { tokenizer, config };
}
