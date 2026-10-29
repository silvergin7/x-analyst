import { createFetchChutesTransport } from "./analyze/chutesClient.js";
import { LlmCallError } from "./analyze/chutesClient.js";
import {
  LlmCitationError,
  LlmOutlookAnalyzer,
  LlmOutputError,
} from "./analyze/llmOutlookAnalyzer.js";
import { MockOutlookAnalyzer } from "./analyze/outlookAnalyzer.js";
import { loadFetchLimits, loadLookbackDays } from "./config.js";
import {
  loadDesearchMaxRequestsPerHandle,
  loadDesearchRequestBudget,
  loadDesearchSettings,
} from "./config/desearchSettings.js";
import {
  LLM_MAX_QUESTION_CHARS,
  llmRuntimeConfigForChutesPlan,
  loadInputMaxChars,
  loadLlmRuntimeConfig,
  parseAnalysisReferenceDate,
  readInputMaxCharsStrict,
} from "./config/llmSettings.js";
import { lookbackCutoffMs } from "./config/timeWindow.js";
import { loadPostsProviderConfig } from "./config/postsProvider.js";
import { DesearchNotConfiguredError } from "./fetch/desearch/desearchPostsFetcher.js";
import { DesearchPaginationError } from "./fetch/desearch/fetchHandlePages.js";
import {
  DesearchRetrievalError,
  type DesearchTransport,
} from "./fetch/desearch/desearchTransport.js";
import { createPostsFetcherFromEnv } from "./fetch/createPostsFetcher.js";
import type { ChutesTransport } from "./analyze/chutesClient.js";
import {
  fetchCacheKey,
  sharedFetchSliceCache,
  type FetchSliceCache,
} from "./runtime/fetchCache.js";
import {
  resolveSliceDirectory,
  SavedSliceError,
  loadSlice,
  outcomesForSlice,
  readRepositoryCommit,
  saveSlice,
} from "./runtime/savedSlice.js";
import type { ChutesModelPlan } from "./analyze/chutesModelSelection.js";
import { LlmRunSpendLedger } from "./analyze/llmRunSpendLedger.js";
import { readAnalyzeCliTransportDeps } from "./analyze/analyzeCliDeps.js";
import { createFetchChutesCatalogTransport } from "./analyze/chutesCatalogTransport.js";
import {
  buildChutesModelPlanForRun,
} from "./analyze/buildChutesModelPlanForRun.js";
import { createHuggingFaceModelInfoTransport } from "./analyze/huggingfaceModelInfoTransport.js";
import { recordValidChutesModel } from "./analyze/chutesModelState.js";
import type { ChutesCatalogTransport } from "./analyze/chutesCatalogTransport.js";
import type { HuggingFaceModelInfoTransport } from "./analyze/huggingfaceModelInfo.js";
import type { HuggingFaceDownloadTransport } from "./analyze/huggingfaceTokenizerDownload.js";
import {
  type MutableChutesRunBinding,
} from "./analyze/chutesRuntimeModel.js";
import { loadTokenizerRuntimeFromJsonPath } from "./analyze/tokenizerRuntime.js";
import { readTokenizerJsonPath } from "./analyze/tokenizerRuntimeEnv.js";
import type {
  AnalysisProviderLabel,
  AnalysisQuestion,
  DesearchBilling,
  FetchOutcome,
  PersonOutlookReport,
  PostSource,
  BudgetEstimate,
  ChutesModelAttempt,
  ProviderTokenUsage,
} from "./types.js";

export interface HandleAnalysisFailure {
  handle: string;
  message: string;
  providerUsage?: ProviderTokenUsage;
  budgetEstimate?: BudgetEstimate;
  llmModelAttempts?: ChutesModelAttempt[];
}

export interface RunReportResult {
  postsSource: PostSource;
  analysisSource: AnalysisProviderLabel;
  referenceDate: string;
  fetchedAt: string;
  fetchedCommit: string;
  reused: boolean;
  replayed: boolean;
  billing: DesearchBilling[];
  fetchOutcomes: FetchOutcome[];
  reports: PersonOutlookReport[];
  handleFailures: HandleAnalysisFailure[];
}

export interface RunReportOptions {
  referenceDate: string;
  fresh?: boolean;
  /** Load this slice file instead of fetching. Never calls Desearch. */
  replayPath?: string;
  /** Directory for newly fetched slices. Defaults to data/slices. */
  sliceDirectory?: string;
  readCommit?: () => string;
  env?: NodeJS.ProcessEnv;
  cache?: FetchSliceCache;
  desearchTransport?: DesearchTransport;
  chutesTransport?: ChutesTransport;
  /** Called with the local estimate after it passes the checks and before HTTP. */
  onEstimate?: (estimate: BudgetEstimate) => void;
  chutesModelPlan?: ChutesModelPlan;
  catalogTransport?: ChutesCatalogTransport;
  hfTransport?: HuggingFaceModelInfoTransport;
  hfDownloadTransport?: HuggingFaceDownloadTransport;
  /** Owner override from .env LLM_MODEL at run start; never written back into env. */
  ownerForcedModelId?: string;
}

/** Configuration or question rejected before any paid request. */
export class ReportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportConfigError";
  }
}

export interface ReportFailureDetails {
  postsSource: PostSource;
  analysisSource: AnalysisProviderLabel;
  referenceDate: string;
  fetchedAt: string;
  fetchedCommit?: string;
  reused: boolean;
  replayed?: boolean;
  /** False when retrieval failed before a slice was stored. */
  sliceStored: boolean;
  billing: DesearchBilling[];
  /** Successful calls, then the failing call when it reported usage. */
  providerUsages: ProviderTokenUsage[];
}

/** A run that fetched, or reused a slice, and then failed analysis. */
export class ReportRunError extends Error {
  readonly details: ReportFailureDetails;

  constructor(message: string, details: ReportFailureDetails) {
    super(message);
    this.name = "ReportRunError";
    this.details = details;
  }
}

function collectBilling(outcomes: FetchOutcome[]): DesearchBilling[] {
  const billing: DesearchBilling[] = [];
  for (const outcome of outcomes) {
    if (outcome.billing) billing.push(...outcome.billing);
  }
  return billing;
}

function estimateFrom(err: unknown): BudgetEstimate | undefined {
  if (err !== null && typeof err === "object" && "estimate" in err) {
    const estimate = (err as { estimate?: BudgetEstimate }).estimate;
    if (estimate && typeof estimate.estimatedUsd === "number") return estimate;
  }
  return undefined;
}

function usageFrom(err: unknown): ProviderTokenUsage | null | undefined {
  if (err !== null && typeof err === "object" && "providerUsage" in err) {
    return (err as { providerUsage?: ProviderTokenUsage | null }).providerUsage;
  }
  return undefined;
}

/**
 * Shared report path for the CLI, API, and web form.
 * Unset or mock providers stay on fixtures and keyword rules.
 * An explicitly selected live provider that cannot run stops before any request.
 * Desearch construction goes through createPostsFetcherFromEnv with the run env
 * and transport. Incomplete Desearch selection uses ineligibleDesearch "throw"
 * because the factory's default still substitutes fixtures.
 */
export async function runReport(
  handles: string[],
  question: AnalysisQuestion,
  options: RunReportOptions,
): Promise<RunReportResult> {
  const env = options.env ?? process.env;
  const referenceDate = parseAnalysisReferenceDate(options.referenceDate);
  if (!referenceDate) {
    throw new ReportConfigError(
      "Analysis reference date must be a real UTC date YYYY-MM-DD. No request was sent.",
    );
  }
  const analysisDate = referenceDate;

  const postsSelected = loadPostsProviderConfig(env).provider;
  const desearchSettings = loadDesearchSettings(env);
  const llm =
    options.chutesModelPlan !== undefined
      ? llmRuntimeConfigForChutesPlan(env, options.chutesModelPlan.primary.model)
      : loadLlmRuntimeConfig(env);
  const problems: string[] = [];
  if (!options.replayPath && postsSelected === "desearch" && !desearchSettings.liveEligible) {
    problems.push(
      "Desearch was selected but is not fully enabled. Set POSTS_PROVIDER=desearch, DESEARCH_LIVE_ENABLED=true, and a real DESEARCH_API_KEY.",
    );
  }
  if (llm.provider === "chutes" && !llm.eligible) {
    problems.push(llm.reason ?? "Chutes was selected but is not fully enabled.");
  }
  if (llm.provider !== "" && llm.provider !== "mock" && llm.provider !== "chutes") {
    problems.push(`ANALYSIS_PROVIDER ${llm.provider} is not supported.`);
  }
  const maxRequestsPerHandle = loadDesearchMaxRequestsPerHandle(env);
  if (
    !options.replayPath &&
    postsSelected === "desearch" &&
    desearchSettings.liveEligible &&
    maxRequestsPerHandle === undefined
  ) {
    problems.push(
      "DESEARCH_MAX_REQUESTS_PER_HANDLE must be a positive integer before a live Desearch fetch.",
    );
  }
  if (problems.length > 0) {
    throw new ReportConfigError(`${problems.join(" ")} No request was sent.`);
  }

  const inputMaxCharsStrict = readInputMaxCharsStrict(env);
  if (!inputMaxCharsStrict.ok) {
    throw new ReportConfigError(`${inputMaxCharsStrict.message}. No request was sent.`);
  }

  let postsSource: PostSource =
    !options.replayPath && postsSelected === "desearch" ? "desearch" : "fixtures";
  const analysisSource: AnalysisProviderLabel = llm.eligible ? "chutes" : "mock-rules";

  if (analysisSource === "chutes") {
    if (question.text.trim() === "" || question.text.length > LLM_MAX_QUESTION_CHARS) {
      throw new ReportConfigError(
        `Question must be 1 to ${LLM_MAX_QUESTION_CHARS} characters. No request was sent.`,
      );
    }
  }

  const limits = loadFetchLimits(env);
  const lookbackDays = loadLookbackDays(env);
  const cutoffMs = lookbackCutoffMs(referenceDate, lookbackDays);
  const inputMaxChars = loadInputMaxChars(env);
  const maxRequestsPerRun = loadDesearchRequestBudget(env);
  const cache = options.cache ?? sharedFetchSliceCache;
  const key = fetchCacheKey({
    postsSource,
    handles,
    maxPostsPerPerson: limits.maxPostsPerPerson,
    maxPostsTotal: limits.maxPostsTotal,
    maxRequestsPerRun,
    maxRequestsPerHandle: maxRequestsPerHandle ?? null,
    lookbackDays,
    referenceDate,
  });

  let fetchOutcomes: FetchOutcome[];
  let fetchedAt: string;
  let fetchedCommit: string;
  let reused: boolean;
  let replayed = false;
  if (options.replayPath) {
    if (options.fresh) {
      throw new ReportConfigError(
        "--replay cannot be combined with a fresh fetch. No request was sent.",
      );
    }
    let saved;
    try {
      saved = loadSlice(options.replayPath);
    } catch (err) {
      const message = err instanceof SavedSliceError ? err.message : "Could not read the slice file";
      throw new ReportConfigError(`${message} No request was sent.`);
    }
    if (saved.handles.join("\n") !== handles.join("\n")) {
      throw new ReportConfigError(
        "Slice handles do not match this run. No request was sent.",
      );
    }
    postsSource = saved.postsSource;
    fetchOutcomes = saved.outcomes;
    fetchedAt = saved.fetchedAt;
    fetchedCommit = saved.fetchedCommit;
    reused = false;
    replayed = true;
  } else if (!options.fresh) {
    const hit = cache.read(key);
    if (hit) {
      fetchOutcomes = hit.outcomes;
      fetchedAt = hit.fetchedAt;
      fetchedCommit = hit.fetchedCommit;
      reused = true;
    } else {
      const stored = await fetchAndStore();
      fetchOutcomes = stored.outcomes;
      fetchedAt = stored.fetchedAt;
      fetchedCommit = stored.fetchedCommit;
      reused = false;
    }
  } else {
    const stored = await fetchAndStore();
    fetchOutcomes = stored.outcomes;
    fetchedAt = stored.fetchedAt;
    fetchedCommit = stored.fetchedCommit;
    reused = false;
  }

  const billing = collectBilling(fetchOutcomes);
  const { reports, handleFailures } = await analyze(fetchOutcomes);

  return {
    postsSource,
    analysisSource,
    referenceDate,
    fetchedAt,
    fetchedCommit,
    reused,
    replayed,
    billing,
    fetchOutcomes,
    reports,
    handleFailures,
  };

  async function fetchAndStore(): Promise<{
    outcomes: FetchOutcome[];
    fetchedAt: string;
    fetchedCommit: string;
  }> {
    let outcomes: FetchOutcome[];
    try {
      const fetcher = createPostsFetcherFromEnv({
        env,
        transport: options.desearchTransport,
        ineligibleDesearch: "throw",
      });
      outcomes = await fetcher.fetchForHandles(
        handles,
        limits,
        postsSource === "desearch" ? { lookbackCutoffMs: cutoffMs } : undefined,
      );
    } catch (err) {
      throw retrievalFailure(err);
    }
    const read = options.readCommit?.();
    const commit = typeof read === "string" && read.trim() !== "" ? read : readRepositoryCommit();
    const stored = cache.store(key, outcomes, commit);
    try {
      saveSlice(resolveSliceDirectory(env, options.sliceDirectory), {
        version: 1,
        fetchedAt: stored.fetchedAt,
        fetchedCommit: commit,
        referenceDate: analysisDate,
        handles,
        postsSource,
        outcomes: outcomesForSlice(outcomes),
      });
    } catch (err) {
      const message = err instanceof SavedSliceError ? err.message : "Could not save the fetched slice";
      throw new ReportRunError(`${message} No further request was sent.`, {
        postsSource,
        analysisSource,
        referenceDate: analysisDate,
        fetchedAt: stored.fetchedAt,
        fetchedCommit: commit,
        reused: false,
        replayed: false,
        sliceStored: true,
        billing: collectBilling(outcomes),
        providerUsages: [],
      });
    }
    return { outcomes: stored.outcomes, fetchedAt: stored.fetchedAt, fetchedCommit: commit };
  }

  function retrievalFailure(err: unknown): ReportConfigError | ReportRunError {
    if (err instanceof DesearchRetrievalError || err instanceof DesearchPaginationError) {
      return new ReportRunError(`${err.message} No further request was sent.`, {
        postsSource,
        analysisSource,
        referenceDate: analysisDate,
        fetchedAt: "",
        fetchedCommit: "",
        reused: false,
        replayed: false,
        sliceStored: false,
        billing: err.billing,
        providerUsages: [],
      });
    }
    if (err instanceof DesearchNotConfiguredError) {
      return new ReportConfigError(`${err.message} No request was sent.`);
    }
    return new ReportConfigError(
      "Retrieval failed unexpectedly. No further request was sent.",
    );
  }

  async function analyze(outcomes: FetchOutcome[]): Promise<{
    reports: PersonOutlookReport[];
    handleFailures: HandleAnalysisFailure[];
  }> {
    const runLedger = analysisSource === "chutes" ? new LlmRunSpendLedger() : undefined;
    const transportDeps = readAnalyzeCliTransportDeps();
    const catalogTransport =
      options.catalogTransport ?? transportDeps.catalogTransport ?? createFetchChutesCatalogTransport();
    const hfTransport =
      options.hfTransport ?? transportDeps.hfTransport ?? createHuggingFaceModelInfoTransport();
    const hfDownloadTransport = options.hfDownloadTransport ?? transportDeps.hfDownloadTransport;
    const activeRunBinding: MutableChutesRunBinding = {};
    if (options.chutesModelPlan !== undefined) {
      const jsonPath = readTokenizerJsonPath(env);
      const root = env.CHUTES_TOKENIZER_ROOT?.trim();
      const commit = env.CHUTES_TOKENIZER_COMMIT?.trim();
      const sha256 = env.CHUTES_TOKENIZER_SHA256?.trim();
      if (
        jsonPath !== undefined &&
        root !== undefined &&
        root !== "" &&
        commit !== undefined &&
        commit !== "" &&
        sha256 !== undefined &&
        sha256 !== ""
      ) {
        activeRunBinding.current = {
          catalogModel: options.chutesModelPlan.primary.model,
          runtimeConfig: llm,
          tokenizerJsonPath: jsonPath,
          tokenizerPin: { root, commit, sha256 },
          tokenizerRuntime: loadTokenizerRuntimeFromJsonPath(jsonPath),
        };
      }
    }
    const planRef =
      options.chutesModelPlan === undefined
        ? undefined
        : { current: options.chutesModelPlan };
    const ownerForcedModelId = options.ownerForcedModelId?.trim();
    const rebuildChutesModelPlan =
      planRef === undefined ||
      (ownerForcedModelId !== undefined && ownerForcedModelId !== "")
        ? undefined
        : async (excludeModelIds: readonly string[]) => {
            const replay = options.replayPath !== undefined;
            const plan = await buildChutesModelPlanForRun({
              env,
              handles,
              question: question.text,
              referenceDate: analysisDate,
              replay,
              catalogTransport,
              hfTransport,
              hfDownloadTransport,
              excludeModelIds,
              ownerForcedModelId,
            });
            planRef.current = plan;
            if (activeRunBinding.current !== undefined) {
              activeRunBinding.current = {
                ...activeRunBinding.current,
                catalogModel: plan.primary.model,
                runtimeConfig: llmRuntimeConfigForChutesPlan(env, plan.primary.model),
              };
            }
            return plan;
          };
    const analyzer =
      analysisSource === "chutes"
        ? new LlmOutlookAnalyzer(
            llm,
            options.chutesTransport ?? createFetchChutesTransport(),
            referenceDate,
            postsSource,
            {
              runEnv: env,
              onEstimate: options.onEstimate,
              runLedger,
              chutesModelPlan: planRef?.current,
              chutesModelPlanRef: planRef,
              hfModelTransport: hfTransport,
              hfDownloadTransport,
              activeRunBinding,
              rebuildChutesModelPlan,
            },
          )
        : new MockOutlookAnalyzer();
    const reports: PersonOutlookReport[] = [];
    const handleFailures: HandleAnalysisFailure[] = [];
    for (const outcome of outcomes) {
      if (outcome.status !== "ok") continue;
      try {
        const report = await analyzer.analyzePerson(outcome.handle, outcome.posts, question, {
          retrievalComplete: outcome.retrievalComplete,
          incompleteReason: outcome.incompleteReason,
          fetchStopReason: outcome.fetchStopReason,
          lookbackCutoffMs: postsSource === "desearch" ? cutoffMs : undefined,
          inputMaxChars,
          duplicatePostsRemoved: outcome.duplicatePostsRemoved,
          invalidPostsSkipped: outcome.invalidPostsSkipped,
        });
        reports.push(report);
        if (report.llmModel !== undefined && report.modelInvoked === true) {
          recordValidChutesModel(report.llmModel, env);
        }
      } catch (err) {
        const known =
          err instanceof LlmCallError ||
          err instanceof LlmOutputError ||
          err instanceof LlmCitationError;
        const failedUsage = usageFrom(err);
        const estimate = estimateFrom(err);
        handleFailures.push({
          handle: outcome.handle,
          message: known ? err.message : "Analysis failed unexpectedly",
          ...(failedUsage ? { providerUsage: failedUsage } : {}),
          ...(estimate ? { budgetEstimate: estimate } : {}),
          ...(err instanceof LlmCallError && err.llmModelAttempts !== undefined
            ? { llmModelAttempts: err.llmModelAttempts }
            : {}),
        });
      }
    }
    return { reports, handleFailures };
  }
}
