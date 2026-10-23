import { setQwenTokenizerRuntimeForTests, type QwenTokenizerRuntime } from "../../src/analyze/qwenTokenizerRuntime.js";

export function installByteQuarterMockTokenizer(): void {
  const runtime: QwenTokenizerRuntime = {
    encode(text: string) {
      const n = Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
      return Array.from({ length: n }, (_, index) => index);
    },
    renderChat(messages) {
      return messages.map((message) => `${message.role}\n${message.content}`).join("\n\n");
    },
  };
  setQwenTokenizerRuntimeForTests(runtime);
}

export function clearMockTokenizer(): void {
  setQwenTokenizerRuntimeForTests(null);
}
