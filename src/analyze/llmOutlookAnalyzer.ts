import {
  DEFAULT_ANALYSIS_REFERENCE_DATE,
  LLM_MAX_QUESTION_CHARS,
  parseAnalysisReferenceDate,
} from "../config/llmSettings.js";
import type {
  AnalysisQuestion,
  BudgetEstimate,
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
import { requestChutesCompletion, type ChutesTransport } from "./chutesClient.js";
import type { LlmRunSpendLedger } from "./llmRunSpendLedger.js";
import {
  requestChutesCompletionWithFallbacks,
  type PreparedChutesAttempt,
} from "./chutesModelFallbackCall.js";
import type { ChutesCatalogModel } from "./chutesModelCatalog.js";
import type { ChutesModelPlan } from "./chutesModelSelection.js";
import {
  createFetchHfDownloadTransport,
  loadTokenizerCache,
  type HuggingFaceDownloadTransport,
} from "./huggingfaceTokenizerDownload.js";
import {
  chutesRuntimeConfigFromCatalogModel,
  type MutableChutesRunBinding,
} from "./chutesRuntimeModel.js";
import { loadTokenizerRuntimeFromJsonPath } from "./tokenizerRuntime.js";
import type { HuggingFaceModelInfoTransport } from "./huggingfaceModelInfo.js";
import { buildChatMessages, estimateRequestBudget, buildChutesRequestBody } from "./llmPrompt.js";
import {
  fitsModelContextWindow,
  loadLlmRuntimeConfig,
  LLM_CALL_BUDGET_USD,
  type LlmRuntimeConfig,
} from "../config/llmSettings.js";
import {
  applyTokenizerPinToEnv,
  readTokenizerJsonPath,
} from "./tokenizerRuntimeEnv.js";
import type { TokenizerPin } from "../types.js";
import type { OutlookAnalyzer } from "./outlookAnalyzer.js";
import { validateEvidenceIntegrity } from "./outlookAnalyzer.js";
import { checkClassifications, parseModelOutlook, resolveAliasClassifications } from "./classification.js";
import { postAliases } from "./postAliases.js";
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
export interface LlmOutlookAnalyzerOptions {
  runEnv: NodeJS.ProcessEnv;
  onEstimate?: (estimate: BudgetEstimate) => void;
  runLedger?: LlmRunSpendLedger;
  chutesModelPlan?: ChutesModelPlan;
  chutesModelPlanRef?: { current: ChutesModelPlan };
  hfModelTransport?: HuggingFaceModelInfoTransport;
  hfDownloadTransport?: HuggingFaceDownloadTransport;
  activeRunBinding?: MutableChutesRunBinding;
  rebuildChutesModelPlan?: (excludeModelIds: readonly string[]) => Promise<ChutesModelPlan>;
}

export class LlmOutlookAnalyzer implements OutlookAnalyzer {
  private readonly referenceDate: string;
  private readonly postSource: PostSource;

  constructor(
    config: LlmRuntimeConfig,
    transport: ChutesTransport,
    referenceDate: string | undefined,
    postSource: PostSource,
    options: LlmOutlookAnalyzerOptions,
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
    this.runEnv = options.runEnv;
    this.onEstimate = options.onEstimate;
    this.runLedger = options.runLedger;
    this.chutesModelPlan = options.chutesModelPlan;
    this.chutesModelPlanRef = options.chutesModelPlanRef;
    this.hfModelTransport = options.hfModelTransport;
    this.hfDownloadTransport = options.hfDownloadTransport;
    this.activeRunBinding = options.activeRunBinding;
    this.rebuildChutesModelPlan = options.rebuildChutesModelPlan;
  }

  private readonly config: LlmRuntimeConfig;
  private readonly transport: ChutesTransport;
  private readonly runEnv: NodeJS.ProcessEnv;
  private readonly onEstimate?: (estimate: BudgetEstimate) => void;
  private readonly runLedger?: LlmRunSpendLedger;
  private readonly chutesModelPlan?: ChutesModelPlan;
  private readonly chutesModelPlanRef?: { current: ChutesModelPlan };
  private readonly hfModelTransport?: HuggingFaceModelInfoTransport;
  private readonly hfDownloadTransport?: HuggingFaceDownloadTransport;
  private readonly activeRunBinding?: MutableChutesRunBinding;
  private readonly rebuildChutesModelPlan?: (
    excludeModelIds: readonly string[],
  ) => Promise<ChutesModelPlan>;

  private activeConfig(): LlmRuntimeConfig {
    return this.activeRunBinding?.current?.runtimeConfig ?? this.config;
  }

  private commitSuccessfulModel(modelId: string, tokenizerPin: TokenizerPin, tokenizerJsonPath: string): void {
    const plan = this.chutesModelPlanRef?.current ?? this.chutesModelPlan;
    const candidate = plan?.candidates.find((item) => item.model.id === modelId);
    if (candidate === undefined || this.activeRunBinding === undefined) return;
    const runtimeConfig = chutesRuntimeConfigFromCatalogModel(
      candidate.model,
      this.config.chatCompletionsUrl,
      this.config.apiKey,
    );
    this.activeRunBinding.current = {
      catalogModel: candidate.model,
      runtimeConfig,
      tokenizerJsonPath,
      tokenizerPin,
      tokenizerRuntime: loadTokenizerRuntimeFromJsonPath(tokenizerJsonPath),
    };
    applyTokenizerPinToEnv(this.runEnv, tokenizerJsonPath, tokenizerPin);
  }

  private readTokenizerPin(): TokenizerPin | undefined {
    const root = this.runEnv.CHUTES_TOKENIZER_ROOT?.trim();
    const commit = this.runEnv.CHUTES_TOKENIZER_COMMIT?.trim();
    const sha256 = this.runEnv.CHUTES_TOKENIZER_SHA256?.trim();
    if (root === undefined || root === "" || commit === undefined || commit === "" || sha256 === undefined || sha256 === "") {
      return undefined;
    }
    return { root, commit, sha256 };
  }

  private async prepareFallbackAttempt(
    model: ChutesCatalogModel,
    posts: Post[],
    handle: string,
    question: string,
    retrieval: RetrievalContext,
  ): Promise<PreparedChutesAttempt | null> {
    if (this.hfModelTransport === undefined) return null;
    const info = await this.hfModelTransport.fetchModelInfo(model.root);
    if (info === null) return null;
    const downloadTransport = this.hfDownloadTransport ?? createFetchHfDownloadTransport();
    let loaded;
    try {
      loaded = await loadTokenizerCache(model.root, info.sha, this.runEnv, downloadTransport);
    } catch {
      return null;
    }
    const runtime = loadTokenizerRuntimeFromJsonPath(loaded.tokenizerJsonPath);
    const config = chutesRuntimeConfigFromCatalogModel(
      model,
      this.config.chatCompletionsUrl,
      this.config.apiKey,
    );
    const refit = fitAnalysisInputToContextWindow(
      planAnalysisInput(posts, handle, {
        inputMaxChars: retrieval.inputMaxChars,
        lookbackCutoffMs: retrieval.lookbackCutoffMs,
      }),
      {
        question,
        referenceDate: this.referenceDate,
        postSource: this.postSource,
        env: this.runEnv,
        modelId: model.id,
        contextLengthTokens: model.contextLength,
        tokenizerJsonPath: loaded.tokenizerJsonPath,
        tokenizerRuntime: runtime,
      },
    );
    if (refit.sent.length === 0) return null;
    const aliases = postAliases(refit.sent).map((item) => item.alias);
    const maxTokens = classificationOutputTokenCeiling(refit.sent.length, this.runEnv, runtime);
    const messages = buildChatMessages(
      question,
      refit.sent,
      this.referenceDate,
      this.postSource,
    );
    const body = buildChutesRequestBody(messages, config.model, maxTokens, aliases);
    const estimate = estimateRequestBudget(body, this.runEnv, model.pricing, runtime);
    if (estimate.estimatedUsd > LLM_CALL_BUDGET_USD) return null;
    if (
      !fitsModelContextWindow(
        config.contextLengthTokens,
        estimate.inputTokensUpper,
        maxTokens,
      )
    ) {
      return null;
    }
    if (this.runLedger !== undefined && this.runLedger.wouldExceedRunBudget(estimate.estimatedUsd)) {
      return null;
    }
    return {
      config,
      messages,
      maxTokens,
      aliases,
      tokenizerPin: loaded.meta,
      tokenizerJsonPath: loaded.tokenizerJsonPath,
      tokenizerRuntime: runtime,
    };
  }

  async analyzePerson(
    handle: string,
    posts: Post[],
    question: AnalysisQuestion,
    retrieval: RetrievalContext,
  ): Promise<PersonOutlookReport> {
    assertQuestionBound(question.text);
    const activeConfig = this.activeConfig();
    const binding = this.activeRunBinding?.current;
    const plan = fitAnalysisInputToContextWindow(
      planAnalysisInput(posts, handle, {
        inputMaxChars: retrieval.inputMaxChars,
        lookbackCutoffMs: retrieval.lookbackCutoffMs,
      }),
      {
        question: question.text,
        referenceDate: this.referenceDate,
        postSource: this.postSource,
        env: this.runEnv,
        modelId: activeConfig.model,
        contextLengthTokens: activeConfig.contextLengthTokens,
        tokenizerJsonPath: binding?.tokenizerJsonPath,
        tokenizerRuntime: binding?.tokenizerRuntime,
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
      invalidPostsSkipped: retrieval.invalidPostsSkipped,
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

    const aliases = postAliases(plan.sent);
    const messages = buildChatMessages(
      question.text,
      plan.sent,
      this.referenceDate,
      this.postSource,
    );
    const runtime = binding?.tokenizerRuntime;
    const maxTokens = classificationOutputTokenCeiling(plan.sent.length, this.runEnv, runtime);
    const aliasIds = aliases.map((item) => item.alias);
    const initialAttempt: PreparedChutesAttempt = {
      config: activeConfig,
      messages,
      maxTokens,
      aliases: aliasIds,
      tokenizerPin: binding?.tokenizerPin ?? this.readTokenizerPin(),
      tokenizerJsonPath: binding?.tokenizerJsonPath ?? readTokenizerJsonPath(this.runEnv),
      tokenizerRuntime: runtime,
    };
    const activePlan = this.chutesModelPlanRef?.current ?? this.chutesModelPlan;
    const callResult =
      activePlan !== undefined && this.hfModelTransport !== undefined
        ? await requestChutesCompletionWithFallbacks({
            primaryConfig: activeConfig,
            plan: activePlan,
            initialAttempt,
            prepareFallback: (model) =>
              this.prepareFallbackAttempt(model, posts, handle, question.text, retrieval),
            refreshPlan: this.rebuildChutesModelPlan
              ? async (excludeModelIds) => {
                  const next = await this.rebuildChutesModelPlan!(excludeModelIds);
                  if (this.chutesModelPlanRef !== undefined) {
                    this.chutesModelPlanRef.current = next;
                  }
                  return next;
                }
              : undefined,
            transport: this.transport,
            env: this.runEnv,
            onEstimate: this.onEstimate,
            runLedger: this.runLedger,
          })
        : await requestChutesCompletion(
            activeConfig,
            messages,
            this.transport,
            this.runEnv,
            maxTokens,
            aliasIds,
            this.onEstimate,
            this.runLedger,
            runtime,
          ).then((completion) => ({
            completion,
            modelId: activeConfig.model,
            modelsTried: [activeConfig.model],
            modelAttempts: [
              {
                modelId: activeConfig.model,
                kind: "sent" as const,
                durationMs: completion.durationMs,
              },
            ],
            tokenizerPin: initialAttempt.tokenizerPin,
            tokenizerJsonPath: initialAttempt.tokenizerJsonPath,
          }));
    const completion = callResult.completion;
    if (callResult.tokenizerPin !== undefined && callResult.tokenizerJsonPath !== undefined) {
      this.commitSuccessfulModel(
        callResult.modelId,
        callResult.tokenizerPin,
        callResult.tokenizerJsonPath,
      );
    }
    try {
      const parsed = parseModelOutlook(
        completion.content,
        aliases.map((item) => item.alias),
      );
      const resolved = resolveAliasClassifications(aliases, parsed);
      const checked = checkClassifications(plan.sent, resolved, this.referenceDate);
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
        ...(checked.explanationTruncated ? { explanationTruncated: true } : {}),
        ...(checked.evidenceDroppedUnclassified !== undefined
          ? { evidenceDroppedUnclassified: checked.evidenceDroppedUnclassified }
          : {}),
        ...(checked.assetOutlooksDropped !== undefined
          ? { assetOutlooksDropped: checked.assetOutlooksDropped }
          : {}),
        modelInvoked: true,
        llmModel: callResult.modelId,
        llmModelsTried: callResult.modelsTried,
        llmModelAttempts: callResult.modelAttempts,
        ...(callResult.tokenizerPin ? { tokenizerPin: callResult.tokenizerPin } : {}),
        providerUsage: completion.providerUsage,
        budgetEstimate: completion.estimate,
      };
    } catch (err) {
      if (err instanceof LlmOutputError || err instanceof LlmCitationError) {
        err.providerUsage = completion.providerUsage;
        err.estimate = completion.estimate;
      }
      throw err;
    }
  }
}

export { LlmCallError } from "./chutesClient.js";
