import { readFileSync } from "node:fs";
import { Tokenizer } from "@huggingface/tokenizers";
import type { ChatMessage } from "./llmPrompt.js";

export interface TokenizerRuntime {
  encode: (text: string) => number[];
}

let testRuntime: TokenizerRuntime | null = null;
const runtimeByPath = new Map<string, TokenizerRuntime>();

export function setTokenizerRuntimeForTests(runtime: TokenizerRuntime | null): void {
  testRuntime = runtime;
}

export function clearTokenizerRuntimeCacheForTests(): void {
  runtimeByPath.clear();
}

export function getTokenizerRuntime(env: NodeJS.ProcessEnv): TokenizerRuntime {
  if (testRuntime) return testRuntime;
  const raw = env.CHUTES_TOKENIZER_JSON_PATH?.trim();
  if (raw === undefined || raw === "") {
    throw new Error("Tokenizer is not loaded for this run");
  }
  return loadTokenizerRuntimeFromJsonPath(raw);
}

export function loadTokenizerRuntimeFromJsonPath(jsonPath: string): TokenizerRuntime {
  const cached = runtimeByPath.get(jsonPath);
  if (cached) return cached;
  const tokenizerJson = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
  const instance = new Tokenizer(tokenizerJson, {});
  const runtime: TokenizerRuntime = {
    encode(text: string) {
      return instance.encode(text, { add_special_tokens: true }).ids;
    },
  };
  runtimeByPath.set(jsonPath, runtime);
  return runtime;
}

export function encodeMessagesContent(
  runtime: TokenizerRuntime,
  messages: readonly ChatMessage[],
): number {
  let total = 0;
  for (const message of messages) {
    total += runtime.encode(message.content).length;
  }
  return total;
}
