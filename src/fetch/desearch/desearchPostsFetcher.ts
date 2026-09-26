import {
  resolveMaxRequestsPerRunOverride,
  loadDesearchSettings,
  resolveDesearchApiKey,
  type DesearchSettings,
} from "../../config/desearchSettings.js";
import { validateHandle } from "../../validation/handles.js";
import type { FetchIncompleteReason, FetchLimits, FetchOutcome } from "../../types.js";
import type { PostsFetcher } from "../postsFetcher.js";
import { outcomeFromRetrievedPosts } from "../limitEnforcement.js";
import { fetchHandlePages } from "./fetchHandlePages.js";
import type { DesearchTransport } from "./desearchTransport.js";

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

      const pageResult = await fetchHandlePages(
        handle,
        this.credential,
        this.transport,
        {
          maxPostsThisHandle,
          remainingTotalCap: remainingTotal,
          requestBudgetRemaining,
        },
      );

      requestBudgetRemaining -= pageResult.requestsUsed;

      if (pageResult.posts.length === 0) {
        if (pageResult.apiHasMorePages || pageResult.stoppedDueToRequestBudget) {
          outcomes.push({
            status: "incomplete",
            handle,
            reason: "desearch_request_budget_exhausted",
          });
        } else {
          outcomes.push({ status: "empty", handle });
        }
        continue;
      }

      const { outcome, remainingTotal: nextRemaining } = outcomeFromRetrievedPosts(
        handle,
        pageResult.posts,
        limits,
        remainingTotal,
      );

      if (
        outcome.status === "ok" &&
        (pageResult.apiHasMorePages || pageResult.truncatedLastResponse)
      ) {
        let incompleteReason: FetchIncompleteReason;
        if (pageResult.stoppedDueToRequestBudget) {
          incompleteReason = "desearch_request_budget_exhausted";
        } else if (pageResult.posts.length >= limits.maxPostsPerPerson) {
          incompleteReason = "per_person_limit_reached";
        } else {
          incompleteReason = "total_post_limit_reached";
        }
        outcomes.push({
          ...outcome,
          retrievalComplete: false,
          incompleteReason,
        });
      } else {
        outcomes.push(outcome);
      }

      remainingTotal = nextRemaining;
    }

    return outcomes;
  }
}
