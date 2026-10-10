import {
  resolveMaxRequestsPerHandleOverride,
  resolveMaxRequestsPerRunOverride,
  loadDesearchSettings,
  resolveDesearchApiKey,
  type DesearchSettings,
} from "../../config/desearchSettings.js";
import { validateHandle } from "../../validation/handles.js";
import type {
  DesearchBilling,
  FetchLimits,
  FetchOutcome,
  FetchStopReason,
} from "../../types.js";
import type { FetchWindow, PostsFetcher } from "../postsFetcher.js";
import { DesearchPaginationError, fetchHandlePages } from "./fetchHandlePages.js";
import {
  DesearchRetrievalError,
  type DesearchTransport,
} from "./desearchTransport.js";

function requestAllowance(
  runRemaining: number,
  perHandle: number | undefined,
): { allowed: number; binding: "per_handle" | "per_run" } {
  if (perHandle !== undefined && perHandle <= runRemaining) {
    return { allowed: perHandle, binding: "per_handle" };
  }
  return { allowed: runRemaining, binding: "per_run" };
}

function requestLimitReason(
  binding: "per_handle" | "per_run",
): "desearch_handle_request_limit_reached" | "desearch_request_budget_exhausted" {
  return binding === "per_handle"
    ? "desearch_handle_request_limit_reached"
    : "desearch_request_budget_exhausted";
}

function limitStopReason(
  stopReason: FetchStopReason,
  binding: "per_handle" | "per_run",
): FetchStopReason {
  if (stopReason !== "desearch_request_budget_exhausted") return stopReason;
  return requestLimitReason(binding);
}

function withBilling(
  outcome: FetchOutcome,
  billing: DesearchBilling[],
): FetchOutcome {
  if (billing.length === 0) return outcome;
  return { ...outcome, billing };
}

export class DesearchNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesearchNotConfiguredError";
  }
}

export interface DesearchPostsFetcherOptions {
  transport: DesearchTransport;
  requireLiveEligible?: boolean;
  settings?: DesearchSettings;
  /** Credential for request signing (tests inject here; otherwise read from env at boundary). */
  credential?: string;
  /** Override request budget (HTTP calls per run). */
  maxRequestsPerRun?: number;
  /**
   * Cap on HTTP calls for one handle.
   * Omit it, or pass a non-positive value, for no per-handle limit.
   */
  maxRequestsPerHandle?: number;
}

/**
 * Desearch-backed PostsFetcher (GET /twitter/user/posts). Not used by CLI default path.
 */
export class DesearchPostsFetcher implements PostsFetcher {
  private readonly transport: DesearchTransport;
  private readonly credential: string;
  private readonly maxRequestsPerRun: number;
  private readonly maxRequestsPerHandle: number | undefined;

  constructor(options: DesearchPostsFetcherOptions) {
    const settings = options.settings ?? loadDesearchSettings();
    if (options.requireLiveEligible !== false && !settings.liveEligible) {
      throw new DesearchNotConfiguredError(
        "Desearch live mode is not enabled. Set POSTS_PROVIDER=desearch, DESEARCH_LIVE_ENABLED=true, and a real DESEARCH_API_KEY after approval. CLI continues to use mock fixtures by default.",
      );
    }
    const credential = options.credential ?? resolveDesearchApiKey();
    if (!credential) {
      throw new DesearchNotConfiguredError(
        "Desearch API key is missing or placeholder. Live retrieval is unavailable.",
      );
    }
    this.transport = options.transport;
    this.credential = credential;
    this.maxRequestsPerRun = resolveMaxRequestsPerRunOverride(
      options.maxRequestsPerRun,
    );
    this.maxRequestsPerHandle = resolveMaxRequestsPerHandleOverride(
      options.maxRequestsPerHandle,
    );
  }

  async fetchForHandles(
    handles: string[],
    _limits: FetchLimits,
    window?: FetchWindow,
  ): Promise<FetchOutcome[]> {
    const outcomes: FetchOutcome[] = [];
    const lookbackCutoffMs = window?.lookbackCutoffMs ?? Number.NEGATIVE_INFINITY;
    let requestBudgetRemaining = this.maxRequestsPerRun;

    for (const raw of handles) {
      const validation = validateHandle(raw);
      if (!validation.ok) {
        outcomes.push({
          status: "invalid_handle",
          handle: raw,
          reason: validation.reason,
        });
        continue;
      }

      const handle = validation.normalized;

      if (requestBudgetRemaining <= 0) {
        outcomes.push({
          status: "incomplete",
          handle,
          reason: "desearch_request_budget_exhausted",
        });
        continue;
      }

      const allowance = requestAllowance(requestBudgetRemaining, this.maxRequestsPerHandle);

      let pageResult: Awaited<ReturnType<typeof fetchHandlePages>>;
      try {
        pageResult = await fetchHandlePages(
          handle,
          this.credential,
          this.transport,
          {
            requestBudgetRemaining: allowance.allowed,
            lookbackCutoffMs,
          },
        );
      } catch (err) {
        const prior = outcomes.flatMap((outcome) => outcome.billing ?? []);
        if (err instanceof DesearchRetrievalError) {
          throw new DesearchRetrievalError(err.message, {
            category: err.category,
            status: err.status,
            billing: [...prior, ...err.billing],
          });
        }
        if (err instanceof DesearchPaginationError) {
          throw new DesearchPaginationError(err.message, [...prior, ...err.billing]);
        }
        throw new DesearchRetrievalError("Retrieval failed unexpectedly.", {
          category: "network",
          billing: prior,
        });
      }

      requestBudgetRemaining -= pageResult.requestsUsed;
      const stoppedForRequests = pageResult.stopReason === "desearch_request_budget_exhausted";
      const requestLimit = requestLimitReason(allowance.binding);
      const fetchStopReason = limitStopReason(pageResult.stopReason, allowance.binding);

      if (pageResult.posts.length === 0) {
        if (stoppedForRequests) {
          outcomes.push(
            withBilling(
              {
                status: "incomplete",
                handle,
                reason: requestLimit,
              },
              pageResult.billing,
            ),
          );
        } else {
          outcomes.push(withBilling({ status: "empty", handle }, pageResult.billing));
        }
        continue;
      }

      outcomes.push(
        withBilling(
          {
            status: "ok",
            handle,
            posts: pageResult.posts,
            retrievalComplete: !stoppedForRequests,
            incompleteReason: stoppedForRequests ? requestLimit : undefined,
            fetchStopReason,
            duplicatePostsRemoved: pageResult.duplicatesRemoved,
          },
          pageResult.billing,
        ),
      );
    }

    return outcomes;
  }
}
