import { FIXTURE_POSTS_BY_HANDLE } from "../fixtures/samplePosts.js";
import { validateHandle } from "../validation/handles.js";
import type {
  FetchIncompleteReason,
  FetchLimits,
  FetchOutcome,
  Post,
} from "../types.js";

export interface PostsFetcher {
  fetchForHandles(
    handles: string[],
    limits: FetchLimits,
  ): Promise<FetchOutcome[]>;
}

function applyLimits(
  posts: readonly Post[],
  perPersonCap: number,
  remainingTotal: number,
): Post[] {
  const capped = posts.slice(0, perPersonCap);
  return capped.slice(0, remainingTotal);
}

function coverageForSlice(
  allPosts: readonly Post[],
  retrieved: Post[],
  limits: FetchLimits,
): { retrievalComplete: boolean; incompleteReason?: FetchIncompleteReason } {
  const wanted = Math.min(allPosts.length, limits.maxPostsPerPerson);
  if (retrieved.length < wanted) {
    return {
      retrievalComplete: false,
      incompleteReason: "total_post_limit_reached",
    };
  }
  if (
    allPosts.length > limits.maxPostsPerPerson &&
    retrieved.length === limits.maxPostsPerPerson
  ) {
    return {
      retrievalComplete: false,
      incompleteReason: "per_person_limit_reached",
    };
  }
  return { retrievalComplete: true };
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

      if (remainingTotal <= 0) {
        outcomes.push({
          status: "incomplete",
          handle,
          reason: "total_post_limit_reached",
        });
        continue;
      }

      const posts = applyLimits(
        allPosts,
        limits.maxPostsPerPerson,
        remainingTotal,
      );
      remainingTotal -= posts.length;

      const coverage = coverageForSlice(allPosts, posts, limits);

      outcomes.push({
        status: "ok",
        handle,
        posts,
        retrievalComplete: coverage.retrievalComplete,
        incompleteReason: coverage.incompleteReason,
      });
    }

    return outcomes;
  }
}
