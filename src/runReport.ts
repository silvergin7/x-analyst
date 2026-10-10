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
  loadInputMaxChars,
  loadLlmRuntimeConfig,
  parseAnalysisReferenceDate,
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
import type {
  AnalysisProviderLabel,
  AnalysisQuestion,
  DesearchBilling,
  FetchOutcome,
  PersonOutlookReport,
  PostSource,
  ProviderTokenUsage,
} from "./types.js";

export interface RunReportResult {
  postsSource: PostSource;
  analysisSource: AnalysisProviderLabel;
  referenceDate: string;
  fetchedAt: string;
  reused: boolean;
  billing: DesearchBilling[];
  fetchOutcomes: FetchOutcome[];
  reports: PersonOutlookReport[];
}

export interface RunReportOptions {
  referenceDate: string;
  fresh?: boolean;
  env?: NodeJS.ProcessEnv;
  cache?: FetchSliceCache;
  desearchTransport?: DesearchTransport;
  chutesTransport?: ChutesTransport;
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
  reused: boolean;
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
  const llm = loadLlmRuntimeConfig(env);
  const problems: string[] = [];
  if (postsSelected === "desearch" && !desearchSettings.liveEligible) {
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
  if (problems.length > 0) {
    throw new ReportConfigError(`${problems.join(" ")} No request was sent.`);
  }

  const postsSource: PostSource = postsSelected === "desearch" ? "desearch" : "fixtures";
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
  const maxRequestsPerHandle = loadDesearchMaxRequestsPerHandle(env);
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
  let reused: boolean;
  if (!options.fresh) {
    const hit = cache.read(key);
    if (hit) {
      fetchOutcomes = hit.outcomes;
      fetchedAt = hit.fetchedAt;
      reused = true;
    } else {
      const stored = await fetchAndStore();
      fetchOutcomes = stored.outcomes;
      fetchedAt = stored.fetchedAt;
      reused = false;
    }
  } else {
    const stored = await fetchAndStore();
    fetchOutcomes = stored.outcomes;
    fetchedAt = stored.fetchedAt;
    reused = false;
  }

  const billing = collectBilling(fetchOutcomes);
  const reports = await analyze(fetchOutcomes, {
    postsSource,
    analysisSource,
    referenceDate,
    fetchedAt,
    reused,
    sliceStored: true,
    billing,
    providerUsages: [],
  });

  return {
    postsSource,
    analysisSource,
    referenceDate,
    fetchedAt,
    reused,
    billing,
    fetchOutcomes,
    reports,
  };

  async function fetchAndStore(): Promise<{ outcomes: FetchOutcome[]; fetchedAt: string }> {
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
    return cache.store(key, outcomes);
  }

  function retrievalFailure(err: unknown): ReportConfigError | ReportRunError {
    if (err instanceof DesearchRetrievalError || err instanceof DesearchPaginationError) {
      return new ReportRunError(`${err.message} No further request was sent.`, {
        postsSource,
        analysisSource,
        referenceDate: analysisDate,
        fetchedAt: "",
        reused: false,
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

  async function analyze(
    outcomes: FetchOutcome[],
    details: ReportFailureDetails,
  ): Promise<PersonOutlookReport[]> {
    const analyzer =
      analysisSource === "chutes"
        ? new LlmOutlookAnalyzer(
            llm,
            options.chutesTransport ?? createFetchChutesTransport(),
            referenceDate,
            postsSource,
          )
        : new MockOutlookAnalyzer();
    const reports: PersonOutlookReport[] = [];
    const providerUsages: ProviderTokenUsage[] = [];
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
        });
        if (report.providerUsage) providerUsages.push(report.providerUsage);
        reports.push(report);
      } catch (err) {
        const failedUsage = usageFrom(err);
        if (failedUsage) providerUsages.push(failedUsage);
        if (
          err instanceof LlmCallError ||
          err instanceof LlmOutputError ||
          err instanceof LlmCitationError
        ) {
          throw new ReportRunError(err.message, {
            ...details,
            providerUsages,
          });
        }
        throw new ReportRunError("Analysis failed unexpectedly", {
          ...details,
          providerUsages,
        });
      }
    }
    return reports;
  }
}
