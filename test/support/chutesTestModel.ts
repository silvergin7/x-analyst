export const TEST_CHUTES_MODEL_ID = "zai-org/GLM-5.2-TEE";

export function withTestChutesModelEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    LLM_MODEL: TEST_CHUTES_MODEL_ID,
    CHUTES_MODEL_PROMPT_USD_PER_MILLION: "0.104",
    CHUTES_MODEL_COMPLETION_USD_PER_MILLION: "0.416",
    CHUTES_MODEL_CONTEXT_LENGTH: "131072",
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
