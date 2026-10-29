import { setTokenizerRuntimeForTests } from "../../src/analyze/tokenBudget.js";
import type { TokenizerRuntime } from "../../src/analyze/tokenizerRuntime.js";

export function installByteQuarterMockTokenizer(): void {
  const runtime: TokenizerRuntime = {
    encode(text: string) {
      const n = Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
      return Array.from({ length: n }, (_, index) => index);
    },
  };
  setTokenizerRuntimeForTests(runtime);
}

export function clearMockTokenizer(): void {
  setTokenizerRuntimeForTests(null);
}
