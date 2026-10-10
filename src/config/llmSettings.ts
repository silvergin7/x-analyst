import type { BudgetEstimate } from "../types.js";

/** Chat completions endpoint for Chutes subnet 64. */
export const CHUTES_CHAT_COMPLETIONS_URL =
  "https://llm.chutes.ai/v1/chat/completions";

/** The only model whose rates are coded for the local budget check. */
export const PRICED_LLM_MODEL = "Qwen/Qwen3-32B-TEE";

/** max_model_len for PRICED_LLM_MODEL on Chutes. */
export const LLM_CONTEXT_WINDOW_TOKENS = 40_960;

/**
 * Tokens held back so the input ceiling plus max_tokens stays inside the context window.
 */
export const LLM_CONTEXT_SAFETY_MARGIN_TOKENS = 1_024;

/** Published Chutes standard input rate for PRICED_LLM_MODEL, USD per 1M tokens. */
export const LLM_INPUT_USD_PER_MILLION = 0.104;

/** Published Chutes standard output rate for PRICED_LLM_MODEL, USD per 1M tokens. */
export const LLM_OUTPUT_USD_PER_MILLION = 0.416;

/**
 * Local ceiling for one later approved fixture call.
 * Chutes does not enforce this dollar amount.
 */
export const LLM_CALL_BUDGET_USD = 0.05;

/** Documented Chutes generation cap field value (`max_tokens`, not max_completion_tokens). */
export const LLM_MAX_OUTPUT_TOKENS = 800;

/** Total characters of eligible post text sent to the model. Not a post-count cap. */
export const LLM_INPUT_MAX_CHARS = 20_000;
export const LLM_MAX_POST_CHARS = 1000;
/** Quoted-post context cut before it is counted toward LLM_INPUT_MAX_CHARS. */
export const LLM_MAX_QUOTE_CONTEXT_CHARS = 500;
export const LLM_MAX_QUESTION_CHARS = 500;
export const LLM_MAX_EXPLANATION_CHARS = 1500;
export const LLM_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Extra input-token allowance per chat message for template special tokens
 * that are not present in the serialized JSON body.
 */
export const LLM_FRAMING_TOKENS_PER_MESSAGE = 32;

export const LLM_API_KEY_PLACEHOLDER = "replace_me_only_when_you_are_ready";

/**
 * Fallback reference date for fixture-source analyzer construction that omits one.
 * Live Desearch runs pass the UTC date of that invocation instead.
 */
export const DEFAULT_ANALYSIS_REFERENCE_DATE = "2026-10-09";

const REFERENCE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Accept a real UTC calendar date. Returns undefined when the text is not YYYY-MM-DD. */
export function parseAnalysisReferenceDate(value: string): string | undefined {
  const match = REFERENCE_DATE_RE.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return undefined;
  }
  return value;
}

/** UTC calendar date for a run that does not pass --as-of. */
export function utcReferenceDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Documented non-thinking sampling for Qwen3-32B on Chutes. */
export const LLM_NON_THINKING_SAMPLING = {
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
} as const;

export interface LlmRuntimeConfig {
  provider: string;
  liveEnabled: boolean;
  apiKey: string;
  model: string;
  eligible: boolean;
  reason?: string;
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

/** Character budget for posts sent to the model. Malformed values use the default. */
export function loadInputMaxChars(env: NodeJS.ProcessEnv = process.env): number {
  const raw = readEnv(env, "LLM_INPUT_MAX_CHARS");
  if (raw === "" || !/^\d+$/.test(raw)) return LLM_INPUT_MAX_CHARS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < 1) return LLM_INPUT_MAX_CHARS;
  return n;
}

/** Resolve opt-in Chutes gates. Missing or mock provider is not eligible. */
export function loadLlmRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlmRuntimeConfig {
  const provider = readEnv(env, "ANALYSIS_PROVIDER").toLowerCase();
  const liveEnabled = readEnv(env, "LLM_LIVE_ENABLED") === "true";
  const apiKey = readEnv(env, "CHUTES_API_KEY");
  const modelRaw = readEnv(env, "LLM_MODEL");
  const model = modelRaw === "" ? PRICED_LLM_MODEL : modelRaw;

  const base = { provider, liveEnabled, apiKey, model };

  if (provider !== "chutes") {
    return {
      ...base,
      eligible: false,
      reason: "ANALYSIS_PROVIDER must be chutes before a model call",
    };
  }
  if (!liveEnabled) {
    return {
      ...base,
      eligible: false,
      reason: "LLM_LIVE_ENABLED must be true before a model call",
    };
  }
  if (apiKey === "" || apiKey === LLM_API_KEY_PLACEHOLDER) {
    return {
      ...base,
      eligible: false,
      reason: "CHUTES_API_KEY must be a real key, not the placeholder",
    };
  }
  if (model !== PRICED_LLM_MODEL) {
    return {
      ...base,
      eligible: false,
      reason: `LLM_MODEL ${model} has no coded rate. Reassess the estimate before use`,
    };
  }

  return { ...base, eligible: true };
}

/** True when the input ceiling plus max_tokens fits in the context window minus the safety margin. */
export function fitsModelContextWindow(inputTokensUpper: number, maxTokens: number): boolean {
  return (
    inputTokensUpper + maxTokens <=
    LLM_CONTEXT_WINDOW_TOKENS - LLM_CONTEXT_SAFETY_MARGIN_TOKENS
  );
}

/** Pessimistic USD ceiling from an input-token upper bound and the coded output cap. */
export function priceTokenCeiling(
  inputTokensUpper: number,
  outputTokensUpper: number = LLM_MAX_OUTPUT_TOKENS,
): Pick<BudgetEstimate, "estimatedUsd" | "inputTokensUpper" | "outputTokensUpper"> {
  const estimatedUsd =
    (inputTokensUpper * LLM_INPUT_USD_PER_MILLION) / 1_000_000 +
    (outputTokensUpper * LLM_OUTPUT_USD_PER_MILLION) / 1_000_000;
  return { inputTokensUpper, outputTokensUpper, estimatedUsd };
}
