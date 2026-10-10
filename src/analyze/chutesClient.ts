import {
  CHUTES_CHAT_COMPLETIONS_URL,
  LLM_CALL_BUDGET_USD,
  LLM_REQUEST_TIMEOUT_MS,
  type LlmRuntimeConfig,
} from "../config/llmSettings.js";
import type { BudgetEstimate, ProviderTokenUsage } from "../types.js";
import {
  buildChutesRequestBody,
  estimateRequestBudget,
  type ChatMessage,
  type ChutesRequestBody,
} from "./llmPrompt.js";

export type LlmFailureCode =
  | "gate"
  | "budget"
  | "http"
  | "timeout"
  | "refusal"
  | "length"
  | "invalid_output";

export class LlmCallError extends Error {
  readonly code: LlmFailureCode;
  readonly estimate?: BudgetEstimate;
  providerUsage: ProviderTokenUsage | null = null;

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
}

/** Node fetch transport. One attempt; the caller does not retry. */
export function createFetchChutesTransport(): ChutesTransport {
  return {
    async post(url, request) {
      const response = await fetch(url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: request.signal,
      });
      return { status: response.status, bodyText: await response.text() };
    },
  };
}

function isTimeoutError(err: unknown): boolean {
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
  return { promptTokens, completionTokens, totalTokens };
}

function failWithUsage(
  code: LlmFailureCode,
  message: string,
  usage: ProviderTokenUsage | null,
): never {
  const error = new LlmCallError(code, message);
  error.providerUsage = usage;
  throw error;
}

function readCompletionContent(payload: unknown): {
  content: string;
  usage: ProviderTokenUsage | null;
} {
  if (!payload || typeof payload !== "object") {
    throw new LlmCallError("invalid_output", "Chutes returned a non-object body");
  }
  const body = payload as Record<string, unknown>;
  const usage = readUsage(body.usage);
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    failWithUsage("invalid_output", "Chutes returned no choices", usage);
  }
  const choice = choices[0];
  if (!choice || typeof choice !== "object") {
    failWithUsage("invalid_output", "Chutes returned an empty choice", usage);
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
    failWithUsage("refusal", "Chutes refused the request", usage);
  }
  if (finishReason === "refusal" || finishReason === "content_filter") {
    failWithUsage("refusal", "Chutes refused the request", usage);
  }
  if (finishReason === "length") {
    failWithUsage("length", "Chutes stopped because max_tokens was exhausted", usage);
  }
  if (finishReason !== "stop") {
    failWithUsage("invalid_output", "Chutes returned an unexpected finish_reason", usage);
  }
  const content = messageRecord?.content;
  if (typeof content !== "string" || content.trim() === "") {
    failWithUsage("invalid_output", "Chutes returned no message content", usage);
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
  maxTokens?: number,
): Promise<ChutesCompletion> {
  if (!config.eligible) {
    throw new LlmCallError(
      "gate",
      config.reason ?? "Chutes live call is not enabled",
    );
  }

  const requestBody = buildChutesRequestBody(messages, config.model, maxTokens);
  const estimate = estimateRequestBudget(requestBody);
  if (estimate.estimatedUsd > LLM_CALL_BUDGET_USD) {
    throw new LlmCallError(
      "budget",
      `Pessimistic estimate $${estimate.estimatedUsd.toFixed(6)} exceeds the $${LLM_CALL_BUDGET_USD.toFixed(2)} local budget`,
      estimate,
    );
  }

  const signal = AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS);
  let response: ChutesTransportResponse;
  try {
    response = await transport.post(CHUTES_CHAT_COMPLETIONS_URL, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new LlmCallError("timeout", "Chutes request timed out");
    }
    throw new LlmCallError("http", "Chutes request failed before a response");
  }

  if (response.status !== 200) {
    throw new LlmCallError(
      "http",
      `Chutes returned HTTP ${response.status}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.bodyText);
  } catch {
    throw new LlmCallError("invalid_output", "Chutes returned invalid JSON");
  }

  const { content, usage } = readCompletionContent(parsed);
  return { content, estimate, providerUsage: usage, requestBody };
}
