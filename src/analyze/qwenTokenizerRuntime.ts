import { Tokenizer } from "@huggingface/tokenizers";
import { readPinnedTokenizerJson, resolveTokenizerDirectory } from "./qwenTokenizerPins.js";
import { renderChatTemplate } from "./chatTemplateRender.js";
import type { ChatMessage } from "./llmPrompt.js";

export interface QwenTokenizerRuntime {
  encode: (text: string) => number[];
  renderChat: (messages: readonly ChatMessage[]) => string;
}

let testRuntime: QwenTokenizerRuntime | null = null;
const verifiedRuntimeByDirectory = new Map<string, QwenTokenizerRuntime>();

export function setQwenTokenizerRuntimeForTests(runtime: QwenTokenizerRuntime | null): void {
  testRuntime = runtime;
}

export function clearQwenTokenizerRuntimeCacheForTests(): void {
  verifiedRuntimeByDirectory.clear();
}

function loadProductionRuntime(env: NodeJS.ProcessEnv): QwenTokenizerRuntime {
  const dir = resolveTokenizerDirectory(env);
  const cached = verifiedRuntimeByDirectory.get(dir);
  if (cached) return cached;
  const { tokenizer, config } = readPinnedTokenizerJson(dir);
  const chatTemplate = config.chat_template;
  if (typeof chatTemplate !== "string" || chatTemplate.trim() === "") {
    throw new Error("tokenizer_config.json is missing chat_template");
  }
  const instance = new Tokenizer(tokenizer, config);
  const runtime: QwenTokenizerRuntime = {
    encode(text: string) {
      return instance.encode(text, { add_special_tokens: true }).ids;
    },
    renderChat(messages: readonly ChatMessage[]) {
      return renderChatTemplate(chatTemplate, messages);
    },
  };
  verifiedRuntimeByDirectory.set(dir, runtime);
  return runtime;
}

export function getQwenTokenizerRuntime(env: NodeJS.ProcessEnv = process.env): QwenTokenizerRuntime {
  if (testRuntime) return testRuntime;
  return loadProductionRuntime(env);
}
