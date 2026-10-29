import type { TokenizerCacheMeta } from "./huggingfaceTokenizerDownload.js";
import { encodeMessagesContent } from "./tokenizerRuntime.js";
import { getTokenizerRuntime, type TokenizerRuntime } from "./tokenizerRuntime.js";

export { encodeMessagesContent };

export function readTokenizerJsonPath(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.CHUTES_TOKENIZER_JSON_PATH?.trim();
  return raw === "" || raw === undefined ? undefined : raw;
}

export function getRunTokenizerRuntime(env: NodeJS.ProcessEnv): TokenizerRuntime {
  return getTokenizerRuntime(env);
}

export function applyTokenizerPinToEnv(
  env: NodeJS.ProcessEnv,
  jsonPath: string,
  meta: TokenizerCacheMeta,
): void {
  env.CHUTES_TOKENIZER_JSON_PATH = jsonPath;
  env.CHUTES_TOKENIZER_ROOT = meta.root;
  env.CHUTES_TOKENIZER_COMMIT = meta.commit;
  env.CHUTES_TOKENIZER_SHA256 = meta.sha256;
}
