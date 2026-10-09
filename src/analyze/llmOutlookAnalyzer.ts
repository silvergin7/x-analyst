import {
  DEFAULT_ANALYSIS_REFERENCE_DATE,
  LLM_MAX_EXPLANATION_CHARS,
  LLM_MAX_QUESTION_CHARS,
  parseAnalysisReferenceDate,
} from "../config/llmSettings.js";
import type {
  AnalysisQuestion,
  EvidenceRef,
  MarketOutlook,
  PersonOutlookReport,
  Post,
  ProviderTokenUsage,
  RetrievalContext,
} from "../types.js";
import { planAnalysisInput, type SentPost } from "./analysisInput.js";
import {
  requestChutesCompletion,
  type ChutesTransport,
} from "./chutesClient.js";
import { buildChatMessages } from "./llmPrompt.js";
import type { LlmRuntimeConfig } from "../config/llmSettings.js";
import type { OutlookAnalyzer } from "./outlookAnalyzer.js";
import { validateEvidenceIntegrity } from "./outlookAnalyzer.js";

const OUTLOOKS = new Set<MarketOutlook>([
  "bullish",
  "bearish",
  "cautious",
  "unclear",
]);

export class LlmOutputError extends Error {
  readonly code = "invalid_output" as const;
  providerUsage: ProviderTokenUsage | null = null;

  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

export class LlmCitationError extends Error {
  readonly code = "citation" as const;
  providerUsage: ProviderTokenUsage | null = null;

  constructor(message: string) {
    super(message);
    this.name = "LlmCitationError";
  }
}

function dateRange(posts: Post[]): { from: string; to: string } | null {
  if (posts.length === 0) return null;
  const times = posts.map((post) => post.timestamp).sort();
  return { from: times[0]!, to: times[times.length - 1]! };
}

function assertQuestionBound(question: string): void {
  if (question.trim() === "") {
    throw new LlmOutputError("Question is required and cannot be empty");
  }
  if (question.length > LLM_MAX_QUESTION_CHARS) {
    throw new LlmOutputError(
      `Question is ${question.length} characters; the limit is ${LLM_MAX_QUESTION_CHARS}`,
    );
  }
}

interface ModelOutlook {
  outlook: MarketOutlook;
  explanation: string;
  evidencePostIds: string[];
}

function parseModelOutlook(content: string): ModelOutlook {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new LlmOutputError("Model content was not JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmOutputError("Model content was not a JSON object");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowed = ["outlook", "explanation", "evidencePostIds"];
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))) {
    throw new LlmOutputError("Model JSON did not match the outlook schema");
  }
  if (typeof record.outlook !== "string" || !OUTLOOKS.has(record.outlook as MarketOutlook)) {
    throw new LlmOutputError("Model outlook was not a supported value");
  }
  if (typeof record.explanation !== "string" || record.explanation.trim() === "") {
    throw new LlmOutputError("Model explanation was empty");
  }
  if (record.explanation.length > LLM_MAX_EXPLANATION_CHARS) {
    throw new LlmOutputError("Model explanation exceeded the length limit");
  }
  if (!Array.isArray(record.evidencePostIds)) {
    throw new LlmOutputError("Model evidencePostIds was not an array");
  }
  if (!record.evidencePostIds.every((id) => typeof id === "string" && id.trim() !== "")) {
    throw new LlmOutputError("Model evidencePostIds contained an invalid id");
  }
  return {
    outlook: record.outlook as MarketOutlook,
    explanation: record.explanation,
    evidencePostIds: record.evidencePostIds as string[],
  };
}

function evidenceFromSent(
  handle: string,
  outlook: MarketOutlook,
  ids: string[],
  sent: SentPost[],
): EvidenceRef[] {
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new LlmCitationError(`Duplicate citation id ${duplicates[0]}`);
  }
  if (outlook !== "unclear" && ids.length === 0) {
    throw new LlmCitationError("A stated outlook requires at least one citation id");
  }

  const byId = new Map(sent.map((item) => [item.post.id, item.post]));
  const evidence: EvidenceRef[] = [];
  for (const id of ids) {
    const post = byId.get(id);
    if (!post) {
      throw new LlmCitationError(`Citation id ${id} was not in the model input`);
    }
    evidence.push({
      postId: post.id,
      url: post.url,
      timestamp: post.timestamp,
      kind: post.kind,
    });
  }

  const reportHandleCheck: PersonOutlookReport = {
    handle,
    outlook,
    explanation: "citation check",
    dateRangeExamined: null,
    postsExamined: sent.length,
    retrievalComplete: true,
    evidence,
    analysisSource: "llm",
  };
  const integrity = validateEvidenceIntegrity(reportHandleCheck, sent.map((item) => item.post));
  if (!integrity.valid) {
    throw new LlmCitationError(integrity.errors.join("; "));
  }
  return evidence;
}

/**
 * Chutes-backed outlook analyzer. The default CLI, API, and web paths do not construct it.
 */
export class LlmOutlookAnalyzer implements OutlookAnalyzer {
  private readonly referenceDate: string;

  constructor(
    config: LlmRuntimeConfig,
    transport: ChutesTransport,
    referenceDate: string = DEFAULT_ANALYSIS_REFERENCE_DATE,
  ) {
    this.config = config;
    this.transport = transport;
    const parsed = parseAnalysisReferenceDate(referenceDate);
    if (!parsed) {
      throw new LlmOutputError("Analysis reference date must be YYYY-MM-DD");
    }
    this.referenceDate = parsed;
  }

  private readonly config: LlmRuntimeConfig;
  private readonly transport: ChutesTransport;

  async analyzePerson(
    handle: string,
    posts: Post[],
    question: AnalysisQuestion,
    retrieval: RetrievalContext,
  ): Promise<PersonOutlookReport> {
    assertQuestionBound(question.text);
    const plan = planAnalysisInput(posts, handle);
    const sentPosts = plan.sent.map((item) => item.post);
    const base = {
      handle,
      dateRangeExamined: dateRange(sentPosts),
      postsExamined: plan.sent.length,
      retrievalComplete: retrieval.retrievalComplete,
      retrievalIncompleteReason: retrieval.incompleteReason,
      analysisInput: plan.records,
      analysisSource: "llm" as const,
      analysisReferenceDate: this.referenceDate,
    };

    if (plan.sent.length === 0) {
      return {
        ...base,
        outlook: "unclear",
        explanation:
          "No original post and no quote with analyst commentary was available. The model was not called. Excluded posts were not model-examined.",
        evidence: [],
        modelInvoked: false,
      };
    }

    const messages = buildChatMessages(question.text, plan.sent, this.referenceDate);
    const completion = await requestChutesCompletion(
      this.config,
      messages,
      this.transport,
    );
    let parsed: ModelOutlook;
    let evidence: EvidenceRef[];
    try {
      parsed = parseModelOutlook(completion.content);
      evidence = evidenceFromSent(
        handle,
        parsed.outlook,
        parsed.evidencePostIds,
        plan.sent,
      );
    } catch (err) {
      if (err instanceof LlmOutputError || err instanceof LlmCitationError) {
        err.providerUsage = completion.providerUsage;
      }
      throw err;
    }

    return {
      ...base,
      outlook: parsed.outlook,
      explanation: parsed.explanation,
      evidence,
      modelInvoked: true,
      providerUsage: completion.providerUsage,
      budgetEstimate: completion.estimate,
    };
  }
}

export { LlmCallError } from "./chutesClient.js";
