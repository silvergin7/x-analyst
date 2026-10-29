import type { FetchOutcome } from "../types.js";

/** Handles whose retrieval failure should fail the CLI exit code. Budget exhaustion is excluded. */
export function fetchOutcomeFailsExit(outcome: FetchOutcome): boolean {
  if (outcome.status === "retrieval_failed") return true;
  if (outcome.status === "incomplete") {
    return outcome.reason === "desearch_page_no_valid_posts";
  }
  if (outcome.status === "ok") {
    return (
      outcome.incompleteReason === "desearch_retrieval_interrupted" ||
      outcome.incompleteReason === "desearch_page_no_valid_posts"
    );
  }
  return false;
}

export function fetchOutcomesFailExit(outcomes: readonly FetchOutcome[]): boolean {
  return outcomes.some(fetchOutcomeFailsExit);
}
