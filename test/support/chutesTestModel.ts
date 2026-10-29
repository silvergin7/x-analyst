import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_CHUTES_MODEL_ID = "zai-org/GLM-5.2-TEE";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
export const TEST_TOKENIZER_JSON_PATH = path.join(repoRoot, "test/fixtures/tokenizer.json");

function testPath(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const own = env[key];
  if (typeof own === "string" && own.trim() !== "") return own;
  const fromProcess = process.env[key];
  if (typeof fromProcess === "string" && fromProcess.trim() !== "") return fromProcess;
  return undefined;
}

export function withTestChutesModelEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const statePath = testPath(env, "X_ANALYST_MODEL_STATE_PATH");
  const tokenizerCacheDir = testPath(env, "X_ANALYST_TOKENIZER_CACHE_DIR");
  return {
    ...env,
    LLM_MODEL: TEST_CHUTES_MODEL_ID,
    CHUTES_MODEL_PROMPT_USD_PER_MILLION: "0.104",
    CHUTES_MODEL_COMPLETION_USD_PER_MILLION: "0.416",
    CHUTES_MODEL_CONTEXT_LENGTH: "131072",
    CHUTES_TOKENIZER_JSON_PATH: TEST_TOKENIZER_JSON_PATH,
    CHUTES_TOKENIZER_ROOT: "zai-org/GLM-5.2",
    CHUTES_TOKENIZER_COMMIT: "a".repeat(40),
    CHUTES_TOKENIZER_SHA256: "test-fixture-sha-not-a-real-pin",
    ...(statePath === undefined ? {} : { X_ANALYST_MODEL_STATE_PATH: statePath }),
    ...(tokenizerCacheDir === undefined
      ? {}
      : { X_ANALYST_TOKENIZER_CACHE_DIR: tokenizerCacheDir }),
  };
}

export function testLlmRuntimeFields(): {
  model: string;
  modelPricing: { promptUsdPerMillion: number; completionUsdPerMillion: number };
  contextLengthTokens: number;
} {
  return {
    model: TEST_CHUTES_MODEL_ID,
    modelPricing: { promptUsdPerMillion: 0.104, completionUsdPerMillion: 0.416 },
    contextLengthTokens: 131_072,
  };
}
