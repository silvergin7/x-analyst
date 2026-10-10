import { STALE_RELEVANT_POST_DAYS, isOlderThanDays } from "../config/timeWindow.js";
import type { AnalysisInputRecord, EvidenceRef } from "../types.js";
import {
  BEYOND_CONTEXT_WINDOW_REASON,
  BEYOND_INPUT_BUDGET_REASON,
  compareTimestamp,
} from "./analysisInput.js";

export interface RelevanceSummary {
  eligiblePostCount: number;
  relevantPostCount: number;
  newestRelevantPostAt?: string;
  viewMayBeStale: boolean;
}

/**
 * Eligible posts are those sent, truncated, or left out because the character
 * budget or the context window filled.
 */
export function eligiblePostCount(records: readonly AnalysisInputRecord[]): number {
  return records.filter(
    (record) =>
      record.disposition === "sent" ||
      record.disposition === "truncated" ||
      record.reason === BEYOND_INPUT_BUDGET_REASON ||
      record.reason === BEYOND_CONTEXT_WINDOW_REASON,
  ).length;
}

/**
 * Relevant posts are the cited ids that already passed the sent-post check.
 * The view may be stale when the newest of those posts is older than 14 days.
 */
export function summarizeRelevance(
  records: readonly AnalysisInputRecord[],
  evidence: readonly EvidenceRef[],
  referenceDate: string,
): RelevanceSummary {
  const eligible = eligiblePostCount(records);
  if (evidence.length === 0) {
    return {
      eligiblePostCount: eligible,
      relevantPostCount: 0,
      viewMayBeStale: false,
    };
  }
  const newest = [...evidence].sort((a, b) =>
    compareTimestamp(b.timestamp, b.postId, a.timestamp, a.postId),
  )[0]!;
  return {
    eligiblePostCount: eligible,
    relevantPostCount: evidence.length,
    newestRelevantPostAt: newest.timestamp,
    viewMayBeStale: isOlderThanDays(
      newest.timestamp,
      referenceDate,
      STALE_RELEVANT_POST_DAYS,
    ),
  };
}
