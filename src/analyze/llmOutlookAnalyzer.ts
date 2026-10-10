import {
  DEFAULT_ANALYSIS_REFERENCE_DATE,
  LLM_MAX_QUESTION_CHARS,
  parseAnalysisReferenceDate,
} from "../config/llmSettings.js";
import type {
  AnalysisQuestion,
  PersonOutlookReport,
  Post,
  PostSource,
  RetrievalContext,
} from "../types.js";
import {
  BEYOND_CONTEXT_WINDOW_REASON,
  comparePostTime,
  planAnalysisInput,
} from "./analysisInput.js";
import { fitAnalysisInputToContextWindow } from "./fitContextWindow.js";
import { summarizeRelevance } from "./relevance.js";
import { classificationOutputTokenCeiling } from "./outputBudget.js";
import {
  requestChutesCompletion,
  type ChutesTransport,
} from "./chutesClient.js";
import { buildChatMessages } from "./llmPrompt.js";
import type { LlmRuntimeConfig } from "../config/llmSettings.js";
import type { OutlookAnalyzer } from "./outlookAnalyzer.js";
import { validateEvidenceIntegrity } from "./outlookAnalyzer.js";
import { checkClassifications, parseModelOutlook } from "./classification.js";
import { LlmCitationError, LlmOutputError } from "./llmErrors.js";

export { LlmCitationError, LlmOutputError };

function dateRange(posts: Post[]): { from: string; to: string } | null {
  if (posts.length === 0) return null;
  const ordered = [...posts].sort(comparePostTime);
  return { from: ordered[0]!.timestamp, to: ordered[ordered.length - 1]!.timestamp };
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

/**
 * Chutes-backed outlook analyzer.
 * Fixture-source construction may omit the reference date.
 * A Desearch run must pass the date for that invocation.
 */
export class LlmOutlookAnalyzer implements OutlookAnalyzer {
  private readonly referenceDate: string;
  private readonly postSource: PostSource;

  constructor(
    config: LlmRuntimeConfig,
    transport: ChutesTransport,
    referenceDate?: string,
    postSource: PostSource = "fixtures",
  ) {
    this.config = config;
    this.transport = transport;
    this.postSource = postSource;
    if (postSource === "desearch" && referenceDate === undefined) {
      throw new LlmOutputError("Live analysis requires an explicit reference date");
    }
    const parsed = parseAnalysisReferenceDate(
      referenceDate ?? DEFAULT_ANALYSIS_REFERENCE_DATE,
    );
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
    const plan = fitAnalysisInputToContextWindow(
      planAnalysisInput(posts, handle, {
        inputMaxChars: retrieval.inputMaxChars,
        lookbackCutoffMs: retrieval.lookbackCutoffMs,
      }),
      {
        question: question.text,
        referenceDate: this.referenceDate,
        postSource: this.postSource,
      },
    );
    const base = {
      handle,
      dateRangeExamined: dateRange(posts),
      postsExamined: plan.sent.length,
      retrievalComplete: retrieval.retrievalComplete,
      retrievalIncompleteReason: retrieval.incompleteReason,
      fetchStopReason: retrieval.fetchStopReason,
      analysisInput: plan.records,
      analysisSource: "llm" as const,
      analysisReferenceDate: this.referenceDate,
      duplicatePostsRemoved: retrieval.duplicatePostsRemoved,
      postsWithMedia: posts.filter((post) => post.hasAttachedMedia === true).length,
    };

    if (plan.sent.length === 0) {
      return {
        ...base,
        ...summarizeRelevance(plan.records, [], this.referenceDate),
        outlook: "unclear",
        explanation: plan.records.some(
          (record) => record.reason === BEYOND_CONTEXT_WINDOW_REASON,
        )
          ? "Every eligible post was left out because the request did not fit the model context window. The model was not called."
          : "No original post and no quote with analyst commentary was available. The model was not called. Excluded posts were not model-examined.",
        evidence: [],
        modelInvoked: false,
      };
    }

    const messages = buildChatMessages(
      question.text,
      plan.sent,
      this.referenceDate,
      this.postSource,
    );
    const completion = await requestChutesCompletion(
      this.config,
      messages,
      this.transport,
      classificationOutputTokenCeiling(plan.sent.length),
    );
    try {
      const parsed = parseModelOutlook(completion.content);
      const checked = checkClassifications(plan.sent, parsed, this.referenceDate);
      const integrity = validateEvidenceIntegrity(
        {
          handle,
          outlook: checked.outlook,
          explanation: "citation check",
          dateRangeExamined: null,
          postsExamined: plan.sent.length,
          retrievalComplete: true,
          evidence: checked.evidence,
          analysisSource: "llm",
        },
        plan.sent.map((item) => item.post),
      );
      if (!integrity.valid) {
        throw new LlmCitationError(integrity.errors.join("; "));
      }
      const relevance = summarizeRelevance(
        plan.records,
        checked.evidence,
        this.referenceDate,
      );
      return {
        ...base,
        ...relevance,
        relevantPostCount: checked.relevantPostCount,
        newestRelevantPostAt: checked.newestRelevantPostAt,
        outlook: checked.outlook,
        explanation: checked.explanation,
        evidence: checked.evidence,
        classifications: checked.classifications,
        assetOutlooks: checked.assetOutlooks,
        modelInvoked: true,
        providerUsage: completion.providerUsage,
        budgetEstimate: completion.estimate,
      };
    } catch (err) {
      if (err instanceof LlmOutputError || err instanceof LlmCitationError) {
        err.providerUsage = completion.providerUsage;
      }
      throw err;
    }
  }
}

export { LlmCallError } from "./chutesClient.js";
