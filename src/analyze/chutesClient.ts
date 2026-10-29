import {
  ChutesPricingError,
  LLM_CALL_BUDGET_USD,
  LLM_CONTEXT_SAFETY_MARGIN_TOKENS,
  LLM_REQUEST_TIMEOUT_MS,
  LLM_RUN_BUDGET_USD,
  fitsModelContextWindow,
  type LlmRuntimeConfig,
} from "../config/llmSettings.js";
import type { LlmRunSpendLedger } from "./llmRunSpendLedger.js";
import type { TokenizerRuntime } from "./tokenizerRuntime.js";
import type { BudgetEstimate, ChutesModelAttempt, ProviderTokenUsage } from "../types.js";
import { Agent, fetch as undiciFetch } from "undici";
import { stripLeadingEmptyThinkingBlock } from "./modelCompletionText.js";
import {
  buildChutesRequestBody,
  estimateRequestBudget,
  type ChatMessage,
  type ChutesRequestBody,
} from "./llmPrompt.js";

export type LlmFailureCode =
  | "gate"
  | "budget"
  | "context_window"
  | "http"
  | "timeout"
  | "refusal"
  | "length"
  | "invalid_output";

export class LlmCallError extends Error {
  readonly code: LlmFailureCode;
  readonly estimate?: BudgetEstimate;
  providerUsage: ProviderTokenUsage | null = null;
  httpStatus?: number;
  durationMs?: number;
  llmModelAttempts?: ChutesModelAttempt[];

  constructor(code: LlmFailureCode, message: string, estimate?: BudgetEstimate) {
    super(message);
    this.name = "LlmCallError";
    this.code = code;
    this.estimate = estimate;
  }
}

export interface ChutesTransportRequest {
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  timeoutMs: number;
}

export interface ChutesTransportResponse {
  status: number;
  bodyText: string;
}

export interface ChutesTransport {
  post(url: string, request: ChutesTransportRequest): Promise<ChutesTransportResponse>;
}

export interface ChutesCompletion {
  content: string;
  estimate: BudgetEstimate;
  providerUsage: ProviderTokenUsage | null;
  requestBody: ChutesRequestBody;
  durationMs: number;
}

/** undici fetch transport. One attempt; the caller does not retry. */
export function createFetchChutesTransport(): ChutesTransport {
  return {
    async post(url, request) {
      const agent = new Agent({
        headersTimeout: request.timeoutMs,
        bodyTimeout: request.timeoutMs,
      });
      try {
        const response = await undiciFetch(url, {
          method: "POST",
          headers: request.headers,
          body: request.body,
          signal: request.signal,
          dispatcher: agent,
        });
        return { status: response.status, bodyText: await response.text() };
      } finally {
        await agent.close();
      }
    },
  };
}

const UNDICI_TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);

function hasUndiciTimeoutCode(err: unknown, seen: Set<object>): boolean {
  if (err === null || typeof err !== "object" || seen.has(err)) return false;
  seen.add(err);
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && UNDICI_TIMEOUT_CODES.has(code)) return true;
  return hasUndiciTimeoutCode((err as { cause?: unknown }).cause, seen);
}

function isTimeoutError(err: unknown): boolean {
  if (hasUndiciTimeoutCode(err, new Set())) return true;
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

function readUsage(value: unknown): ProviderTokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  const promptTokens = usage.prompt_tokens;
  const completionTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens;
  if (
    typeof promptTokens !== "number" ||
    typeof completionTokens !== "number" ||
    typeof totalTokens !== "number" ||
    !Number.isFinite(promptTokens) ||
    !Number.isFinite(completionTokens) ||
    !Number.isFinite(totalTokens)
  ) {
    return null;
  }
  const details = usage.completion_tokens_details;
  let reasoningTokens: number | undefined;
  if (details && typeof details === "object") {
    const reasoning = (details as Record<string, unknown>).reasoning_tokens;
    if (typeof reasoning === "number" && Number.isFinite(reasoning)) {
      reasoningTokens = reasoning;
    }
  }
  return reasoningTokens === undefined
    ? { promptTokens, completionTokens, totalTokens }
    : { promptTokens, completionTokens, totalTokens, reasoningTokens };
}

function failWithUsage(
  code: LlmFailureCode,
  message: string,
  usage: ProviderTokenUsage | null,
  estimate?: BudgetEstimate,
): never {
  const error = new LlmCallError(code, message, estimate);
  error.providerUsage = usage;
  throw error;
}

function readCompletionContent(payload: unknown, estimate: BudgetEstimate): {
  content: string;
  usage: ProviderTokenUsage | null;
} {
  if (!payload || typeof payload !== "object") {
    throw new LlmCallError("invalid_output", "Chutes returned a non-object body", estimate);
  }
  const body = payload as Record<string, unknown>;
  const usage = readUsage(body.usage);
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    failWithUsage("invalid_output", "Chutes returned no choices", usage, estimate);
  }
  const choice = choices[0];
  if (!choice || typeof choice !== "object") {
    failWithUsage("invalid_output", "Chutes returned an empty choice", usage, estimate);
  }
  const choiceRecord = choice as Record<string, unknown>;
  const finishReason = choiceRecord.finish_reason;
  const message = choiceRecord.message;
  const messageRecord =
    message && typeof message === "object"
      ? (message as Record<string, unknown>)
      : undefined;
  const refusal = messageRecord?.refusal;

  if (typeof refusal === "string" && refusal.trim() !== "") {
    failWithUsage("refusal", "Chutes refused the request", usage, estimate);
  }
  if (finishReason === "refusal" || finishReason === "content_filter") {
    failWithUsage("refusal", "Chutes refused the request", usage, estimate);
  }
  if (finishReason === "length") {
    failWithUsage("length", "Chutes stopped because max_tokens was exhausted", usage, estimate);
  }
  if (finishReason !== "stop") {
    failWithUsage("invalid_output", "Chutes returned an unexpected finish_reason", usage, estimate);
  }
  const rawContent = messageRecord?.content;
  if (typeof rawContent !== "string" || rawContent.trim() === "") {
    failWithUsage("invalid_output", "Chutes returned no message content", usage, estimate);
  }
  let content: string;
  try {
    content = stripLeadingEmptyThinkingBlock(rawContent);
  } catch (err) {
    if (err instanceof Error) {
      failWithUsage("invalid_output", err.message, usage, estimate);
    }
    throw err;
  }
  if (content.trim() === "") {
    failWithUsage("invalid_output", "Chutes returned no message content", usage, estimate);
  }
  return { content, usage };
}

/**
 * Send one Chutes chat completion when the gates and local budget allow it.
 * A rejected request, refusal, or token cutoff fails here. There is no retry.
 */
export async function requestChutesCompletion(
  config: LlmRuntimeConfig,
  messages: ChatMessage[],
  transport: ChutesTransport,
  env: NodeJS.ProcessEnv,
  maxTokens: number,
  aliases: readonly string[],
  onEstimate?: (estimate: BudgetEstimate) => void,
  runLedger?: LlmRunSpendLedger,
  tokenizerRuntime?: TokenizerRuntime,
  timeoutMs: number = LLM_REQUEST_TIMEOUT_MS,
): Promise<ChutesCompletion> {
  if (!config.eligible) {
    throw new LlmCallError(
      "gate",
      config.reason ?? "Chutes live call is not enabled",
    );
  }

  const requestBody = buildChutesRequestBody(messages, config.model, maxTokens, aliases);
  let estimate: BudgetEstimate;
  try {
    estimate = estimateRequestBudget(requestBody, env, config.modelPricing, tokenizerRuntime);
  } catch (err) {
    if (err instanceof ChutesPricingError) {
      throw new LlmCallError("gate", err.message);
    }
    throw err;
  }
  if (estimate.estimatedUsd > LLM_CALL_BUDGET_USD) {
    throw new LlmCallError(
      "budget",
      `Pessimistic estimate $${estimate.estimatedUsd.toFixed(6)} exceeds the $${LLM_CALL_BUDGET_USD.toFixed(2)} local budget`,
      estimate,
    );
  }
  if (runLedger !== undefined && runLedger.wouldExceedRunBudget(estimate.estimatedUsd)) {
    throw new LlmCallError(
      "budget",
      `Pessimistic estimate $${estimate.estimatedUsd.toFixed(6)} would exceed the $${LLM_RUN_BUDGET_USD.toFixed(2)} run budget (already committed $${runLedger.totalCommittedUsd.toFixed(6)})`,
      estimate,
    );
  }
  if (
    !fitsModelContextWindow(
      config.contextLengthTokens,
      estimate.inputTokensUpper,
      requestBody.max_tokens,
    )
  ) {
    const budget = config.contextLengthTokens - LLM_CONTEXT_SAFETY_MARGIN_TOKENS;
    throw new LlmCallError(
      "context_window",
      `Input ceiling ${estimate.inputTokensUpper} plus max_tokens ${requestBody.max_tokens} exceeds the context window budget of ${budget}`,
      estimate,
    );
  }

  onEstimate?.(estimate);
  runLedger?.recordCommittedEstimate(estimate.estimatedUsd);
  const started = Date.now();
  let response: ChutesTransportResponse;
  try {
    response = await postChutes(transport, config.chatCompletionsUrl, requestBody, config.apiKey, timeoutMs);
  } catch (err) {
    const durationMs = Date.now() - started;
    if (isTimeoutError(err)) {
      const error = new LlmCallError("timeout", "Chutes request timed out", estimate);
      error.durationMs = durationMs;
      throw error;
    }
    const error = new LlmCallError("http", "Chutes request failed before a response", estimate);
    error.durationMs = durationMs;
    throw error;
  }
  const durationMs = Date.now() - started;

  if (response.status !== 200) {
    const error = new LlmCallError(
      "http",
      `Chutes returned HTTP ${response.status}`,
      estimate,
    );
    error.httpStatus = response.status;
    error.durationMs = durationMs;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.bodyText);
  } catch {
    const error = new LlmCallError("invalid_output", "Chutes returned invalid JSON", estimate);
    error.durationMs = durationMs;
    throw error;
  }

  try {
    const { content, usage } = readCompletionContent(parsed, estimate);
    return { content, estimate, providerUsage: usage, requestBody, durationMs };
  } catch (err) {
    if (err instanceof LlmCallError) err.durationMs = durationMs;
    throw err;
  }
}

function postChutes(
  transport: ChutesTransport,
  url: string,
  requestBody: ChutesRequestBody,
  apiKey: string,
  timeoutMs: number,
): Promise<ChutesTransportResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const postPromise = transport.post(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal,
    timeoutMs,
  });
  postPromise.catch(() => undefined);
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error("Chutes request timed out");
      err.name = "TimeoutError";
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([postPromise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
