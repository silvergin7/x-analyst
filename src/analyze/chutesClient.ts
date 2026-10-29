import {
  LLM_CALL_BUDGET_USD,
  LLM_CONTEXT_SAFETY_MARGIN_TOKENS,
  LLM_REQUEST_TIMEOUT_MS,
  fitsModelContextWindow,
  type LlmRuntimeConfig,
} from "../config/llmSettings.js";
import type { BudgetEstimate, ProviderTokenUsage } from "../types.js";
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
): Promise<ChutesCompletion> {
  if (!config.eligible) {
    throw new LlmCallError(
      "gate",
      config.reason ?? "Chutes live call is not enabled",
    );
  }

  const requestBody = buildChutesRequestBody(messages, config.model, maxTokens, aliases);
  const estimate = estimateRequestBudget(requestBody, env);
  if (estimate.estimatedUsd > LLM_CALL_BUDGET_USD) {
    throw new LlmCallError(
      "budget",
      `Pessimistic estimate $${estimate.estimatedUsd.toFixed(6)} exceeds the $${LLM_CALL_BUDGET_USD.toFixed(2)} local budget`,
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
  const signal = AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS);
  let response: ChutesTransportResponse;
  try {
    response = await transport.post(config.chatCompletionsUrl, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new LlmCallError("timeout", "Chutes request timed out", estimate);
    }
    throw new LlmCallError("http", "Chutes request failed before a response", estimate);
  }

  if (response.status !== 200) {
    throw new LlmCallError(
      "http",
      `Chutes returned HTTP ${response.status}`,
      estimate,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.bodyText);
  } catch {
    throw new LlmCallError("invalid_output", "Chutes returned invalid JSON", estimate);
  }

  const { content, usage } = readCompletionContent(parsed, estimate);
  return { content, estimate, providerUsage: usage, requestBody };
}
