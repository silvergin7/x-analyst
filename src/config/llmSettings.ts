import type { BudgetEstimate } from "../types.js";

/** Chat completions endpoint for Chutes subnet 64. */
export const DEFAULT_CHUTES_CHAT_COMPLETIONS_URL =
  "https://llm.chutes.ai/v1/chat/completions";

/** @deprecated Use DEFAULT_CHUTES_CHAT_COMPLETIONS_URL or loadChutesChatCompletionsUrl. */
export const CHUTES_CHAT_COMPLETIONS_URL = DEFAULT_CHUTES_CHAT_COMPLETIONS_URL;

export function loadChutesChatCompletionsUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CHUTES_CHAT_COMPLETIONS_URL?.trim();
  if (raw === undefined || raw === "") return DEFAULT_CHUTES_CHAT_COMPLETIONS_URL;
  return raw;
}

/**
 * Tokens held back so the input ceiling plus max_tokens stays inside the context window.
 */
export const LLM_CONTEXT_SAFETY_MARGIN_TOKENS = 1_024;

/** Reserved output tokens for model thinking in eligibility and budgets. */
export const LLM_THINKING_ALLOWANCE_TOKENS = 16_000;

/**
 * Local ceiling for one Chutes request worst-case estimate.
 * Chutes does not enforce this dollar amount.
 */
export const LLM_CALL_BUDGET_USD = 0.2;

/** Local ceiling for committed worst-case estimates across one analyze run. */
export const LLM_RUN_BUDGET_USD = 1;

/**
 * A handle fails when unclassified sent posts are a larger share than this.
 * Exactly this share is allowed.
 */
export const UNCLASSIFIED_POST_SHARE_LIMIT = 0.1;

/** Documented Chutes generation cap field value (`max_tokens`, not max_completion_tokens). */
export const LLM_MAX_OUTPUT_TOKENS = 800;

/** Total characters of eligible post text sent to the model. Not a post-count cap. */
export const LLM_INPUT_MAX_CHARS = 20_000;
export const LLM_MAX_POST_CHARS = 1000;
/** Quoted-post context cut before it is counted toward LLM_INPUT_MAX_CHARS. */
export const LLM_MAX_QUOTE_CONTEXT_CHARS = 500;
export const LLM_MAX_QUESTION_CHARS = 500;
export const LLM_MAX_EXPLANATION_CHARS = 1500;
export const LLM_REQUEST_TIMEOUT_MS = 120_000;

export const CHUTES_CATALOG_TIMEOUT_MS = 10_000;

export const CHUTES_CATALOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Extra input-token allowance per chat message for template special tokens
 * that are not present in the serialized JSON body.
 */
export const LLM_FRAMING_TOKENS_PER_MESSAGE = 64;

export const LLM_TOKENIZER_CALIBRATION_FIXED = 128;

export const LLM_TOKENIZER_CALIBRATION_RATIO = 0.03;

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

export interface ChutesModelPricing {
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
}

export interface LlmRuntimeConfig {
  provider: string;
  liveEnabled: boolean;
  apiKey: string;
  model: string;
  chatCompletionsUrl: string;
  modelPricing: ChutesModelPricing;
  contextLengthTokens: number;
  eligible: boolean;
  reason?: string;
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

/** Character budget for posts sent to the model. Malformed values use the default. */
export function loadInputMaxChars(env: NodeJS.ProcessEnv = process.env): number {
  const strict = readInputMaxCharsStrict(env);
  if (!strict.ok) return LLM_INPUT_MAX_CHARS;
  return strict.value;
}

export function readInputMaxCharsStrict(
  env: NodeJS.ProcessEnv,
): { ok: true; value: number } | { ok: false; message: string } {
  const raw = readEnv(env, "LLM_INPUT_MAX_CHARS");
  if (raw === "") return { ok: true, value: LLM_INPUT_MAX_CHARS };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, message: "LLM_INPUT_MAX_CHARS is malformed" };
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < 1) {
    return { ok: false, message: "LLM_INPUT_MAX_CHARS is malformed" };
  }
  return { ok: true, value: n };
}

function loadChutesCallGates(env: NodeJS.ProcessEnv): {
  provider: string;
  liveEnabled: boolean;
  apiKey: string;
  chatCompletionsUrl: string;
  eligible: boolean;
  reason?: string;
} {
  const provider = readEnv(env, "ANALYSIS_PROVIDER").toLowerCase();
  const liveEnabled = readEnv(env, "LLM_LIVE_ENABLED") === "true";
  const apiKey = readEnv(env, "CHUTES_API_KEY");
  const chatCompletionsUrl = loadChutesChatCompletionsUrl(env);
  const base = { provider, liveEnabled, apiKey, chatCompletionsUrl };
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
  return { ...base, eligible: true };
}

/** Resolve opt-in Chutes gates. Missing or mock provider is not eligible. */
export function loadLlmRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlmRuntimeConfig {
  const gates = loadChutesCallGates(env);
  const model = readEnv(env, "LLM_MODEL");
  const pricingPrompt = readEnv(env, "CHUTES_MODEL_PROMPT_USD_PER_MILLION");
  const pricingCompletion = readEnv(env, "CHUTES_MODEL_COMPLETION_USD_PER_MILLION");
  const contextRaw = readEnv(env, "CHUTES_MODEL_CONTEXT_LENGTH");
  const modelPricing: ChutesModelPricing = {
    promptUsdPerMillion: Number(pricingPrompt),
    completionUsdPerMillion: Number(pricingCompletion),
  };
  const contextLengthTokens = Number(contextRaw);
  const base: LlmRuntimeConfig = {
    provider: gates.provider,
    liveEnabled: gates.liveEnabled,
    apiKey: gates.apiKey,
    model,
    chatCompletionsUrl: gates.chatCompletionsUrl,
    modelPricing,
    contextLengthTokens,
    eligible: false,
    reason: gates.reason,
  };
  if (!gates.eligible) return base;
  if (model === "") {
    return { ...base, reason: "Chutes model is not selected" };
  }
  if (
    !Number.isFinite(modelPricing.promptUsdPerMillion) ||
    modelPricing.promptUsdPerMillion <= 0 ||
    !Number.isFinite(modelPricing.completionUsdPerMillion) ||
    modelPricing.completionUsdPerMillion <= 0 ||
    !Number.isFinite(contextLengthTokens) ||
    contextLengthTokens <= 0
  ) {
    return {
      ...base,
      reason: "Chutes model pricing or context window is not configured",
    };
  }
  return { ...base, eligible: true, reason: undefined };
}

export function llmRuntimeConfigForChutesPlan(
  env: NodeJS.ProcessEnv,
  plan: {
    id: string;
    pricing: ChutesModelPricing;
    contextLength: number;
  },
): LlmRuntimeConfig {
  const gates = loadChutesCallGates(env);
  const ineligible: LlmRuntimeConfig = {
    provider: gates.provider,
    liveEnabled: gates.liveEnabled,
    apiKey: gates.apiKey,
    model: plan.id,
    chatCompletionsUrl: gates.chatCompletionsUrl,
    modelPricing: plan.pricing,
    contextLengthTokens: plan.contextLength,
    eligible: false,
    reason: gates.reason,
  };
  if (!gates.eligible) return ineligible;
  return {
    provider: "chutes",
    liveEnabled: true,
    apiKey: gates.apiKey,
    model: plan.id,
    chatCompletionsUrl: gates.chatCompletionsUrl,
    modelPricing: plan.pricing,
    contextLengthTokens: plan.contextLength,
    eligible: true,
  };
}

/** Completion footprint including the thinking allowance reserved in budgets. */
export function completionTokensContextFootprint(maxTokens: number): number {
  return maxTokens + LLM_THINKING_ALLOWANCE_TOKENS;
}

/** True when the input ceiling plus max_tokens fits in the context window minus the safety margin. */
export function fitsModelContextWindow(
  contextLengthTokens: number,
  inputTokensUpper: number,
  maxTokens: number,
): boolean {
  return (
    inputTokensUpper + completionTokensContextFootprint(maxTokens) <=
    contextLengthTokens - LLM_CONTEXT_SAFETY_MARGIN_TOKENS
  );
}

/** Pessimistic USD ceiling from token counts and catalog pricing. */
export function priceTokenCeiling(
  inputTokensUpper: number,
  outputTokensUpper: number,
  pricing: ChutesModelPricing,
): Pick<BudgetEstimate, "estimatedUsd" | "inputTokensUpper" | "outputTokensUpper"> {
  const estimatedUsd =
    (inputTokensUpper * pricing.promptUsdPerMillion) / 1_000_000 +
    (outputTokensUpper * pricing.completionUsdPerMillion) / 1_000_000;
  return { inputTokensUpper, outputTokensUpper, estimatedUsd };
}

