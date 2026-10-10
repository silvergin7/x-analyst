import {
  resolveMaxRequestsPerRunOverride,
  loadDesearchSettings,
  resolveDesearchApiKey,
  type DesearchSettings,
} from "../../config/desearchSettings.js";
import { validateHandle } from "../../validation/handles.js";
import type {
  DesearchBilling,
  FetchIncompleteReason,
  FetchLimits,
  FetchOutcome,
} from "../../types.js";
import type { PostsFetcher } from "../postsFetcher.js";
import { DesearchPaginationError, fetchHandlePages } from "./fetchHandlePages.js";
import {
  DesearchRetrievalError,
  type DesearchTransport,
} from "./desearchTransport.js";

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
}

/**
 * Desearch-backed PostsFetcher (GET /twitter/user/posts). Not used by CLI default path.
 */
export class DesearchPostsFetcher implements PostsFetcher {
  private readonly transport: DesearchTransport;
  private readonly credential: string;
  private readonly maxRequestsPerRun: number;

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
  }

  async fetchForHandles(
    handles: string[],
    limits: FetchLimits,
  ): Promise<FetchOutcome[]> {
    const outcomes: FetchOutcome[] = [];
    let remainingTotal = limits.maxPostsTotal;
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

      if (remainingTotal <= 0) {
        outcomes.push({
          status: "incomplete",
          handle,
          reason: "total_post_limit_reached",
        });
        continue;
      }

      if (requestBudgetRemaining <= 0) {
        outcomes.push({
          status: "incomplete",
          handle,
          reason: "desearch_request_budget_exhausted",
        });
        continue;
      }

      const maxPostsThisHandle = Math.min(limits.maxPostsPerPerson, remainingTotal);

      let pageResult: Awaited<ReturnType<typeof fetchHandlePages>>;
      try {
        pageResult = await fetchHandlePages(
          handle,
          this.credential,
          this.transport,
          {
            maxPostsThisHandle,
            remainingTotalCap: remainingTotal,
            requestBudgetRemaining,
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

      if (pageResult.posts.length === 0) {
        if (pageResult.apiHasMorePages || pageResult.stoppedDueToRequestBudget) {
          outcomes.push(
            withBilling(
              {
                status: "incomplete",
                handle,
                reason: "desearch_request_budget_exhausted",
              },
              pageResult.billing,
            ),
          );
        } else {
          outcomes.push(withBilling({ status: "empty", handle }, pageResult.billing));
        }
        continue;
      }

      const posts = pageResult.posts;
      let incompleteReason: FetchIncompleteReason | undefined;
      if (pageResult.apiHasMorePages) {
        if (pageResult.stoppedDueToRequestBudget) {
          incompleteReason = "desearch_request_budget_exhausted";
        } else if (posts.length >= limits.maxPostsPerPerson) {
          incompleteReason = "per_person_limit_reached";
        } else {
          incompleteReason = "total_post_limit_reached";
        }
      }
      outcomes.push(
        withBilling(
          {
            status: "ok",
            handle,
            posts,
            retrievalComplete: incompleteReason === undefined,
            incompleteReason,
          },
          pageResult.billing,
        ),
      );

      remainingTotal = Math.max(0, remainingTotal - posts.length);
    }

    return outcomes;
  }
}
