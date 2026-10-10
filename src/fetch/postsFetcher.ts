import { FIXTURE_POSTS_BY_HANDLE } from "../fixtures/samplePosts.js";
import { validateHandle } from "../validation/handles.js";
import type { FetchLimits, FetchOutcome } from "../types.js";
import { outcomeFromRetrievedPosts } from "./limitEnforcement.js";

/** Lookback cutoff for a Desearch fetch. Mock retrieval ignores it. */
export interface FetchWindow {
  lookbackCutoffMs: number;
}

export interface PostsFetcher {
  fetchForHandles(
    handles: string[],
    limits: FetchLimits,
    window?: FetchWindow,
  ): Promise<FetchOutcome[]>;
}

/**
 * Mock post retrieval from local fixtures.
 * Replace with a Desearch-backed implementation in a later step.
 */
export class MockPostsFetcher implements PostsFetcher {
  async fetchForHandles(
    handles: string[],
    limits: FetchLimits,
  ): Promise<FetchOutcome[]> {
    const outcomes: FetchOutcome[] = [];
    let remainingTotal = limits.maxPostsTotal;

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
      if (!(handle in FIXTURE_POSTS_BY_HANDLE)) {
        outcomes.push({ status: "unknown_handle", handle });
        continue;
      }

      const allPosts = FIXTURE_POSTS_BY_HANDLE[handle] ?? [];
      if (allPosts.length === 0) {
        outcomes.push({ status: "empty", handle });
        continue;
      }

      const { outcome, remainingTotal: nextRemaining } = outcomeFromRetrievedPosts(
        handle,
        [...allPosts],
        limits,
        remainingTotal,
      );
      remainingTotal = nextRemaining;
      outcomes.push(outcome);
    }

    return outcomes;
  }
}
