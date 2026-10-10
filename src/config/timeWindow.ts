import type { FetchStopReason } from "../types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A relevant post older than this, relative to the analysis reference date, may be stale. */
export const STALE_RELEVANT_POST_DAYS = 14;

export const FETCH_STOP_LABEL: Record<FetchStopReason, string> = {
  lookback_window_reached: "oldest post is past the lookback window",
  no_more_pages: "no more pages",
  desearch_request_budget_exhausted: "Desearch request limit reached",
};

/** UTC midnight of a YYYY-MM-DD reference date, or null when the date is not that shape. */
export function utcMidnightMs(referenceDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return null;
  const ms = Date.parse(`${referenceDate}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Start of the lookback window. A post strictly earlier than this instant is past the window.
 * The reference date's UTC midnight is inside the window.
 */
export function lookbackCutoffMs(referenceDate: string, lookbackDays: number): number {
  const midnight = utcMidnightMs(referenceDate);
  if (midnight === null) {
    throw new Error("Analysis reference date must be YYYY-MM-DD");
  }
  return midnight - lookbackDays * MS_PER_DAY;
}

/** True when the timestamp is strictly older than `days` before the reference date's UTC midnight. */
export function isOlderThanDays(
  timestamp: string,
  referenceDate: string,
  days: number,
): boolean {
  const postMs = Date.parse(timestamp);
  const midnight = utcMidnightMs(referenceDate);
  if (!Number.isFinite(postMs) || midnight === null) return false;
  return postMs < midnight - days * MS_PER_DAY;
}
