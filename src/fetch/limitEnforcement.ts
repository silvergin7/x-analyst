import type {
  FetchIncompleteReason,
  FetchLimits,
  FetchOutcome,
  Post,
} from "../types.js";

export function applyLimits(
  posts: readonly Post[],
  perPersonCap: number,
  remainingTotal: number,
): Post[] {
  const capped = posts.slice(0, perPersonCap);
  return capped.slice(0, remainingTotal);
}

export function coverageForSlice(
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

/** Build ok/incomplete outcomes after posts for one handle are known. */
export function outcomeFromRetrievedPosts(
  handle: string,
  allPosts: Post[],
  limits: FetchLimits,
  remainingTotal: number,
): { outcome: FetchOutcome; remainingTotal: number } {
  if (remainingTotal <= 0) {
    return {
      outcome: {
        status: "incomplete",
        handle,
        reason: "total_post_limit_reached",
      },
      remainingTotal,
    };
  }

  const posts = applyLimits(allPosts, limits.maxPostsPerPerson, remainingTotal);
  const coverage = coverageForSlice(allPosts, posts, limits);
  return {
    outcome: {
      status: "ok",
      handle,
      posts,
      retrievalComplete: coverage.retrievalComplete,
      incompleteReason: coverage.incompleteReason,
    },
    remainingTotal: remainingTotal - posts.length,
  };
}
