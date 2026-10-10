import {
  LLM_INPUT_MAX_CHARS,
  LLM_MAX_POST_CHARS,
  LLM_MAX_QUOTE_CONTEXT_CHARS,
} from "../config/llmSettings.js";
import type { AnalysisInputRecord, Post } from "../types.js";

export const SENT_TEXT_EXCERPT_CHARS = 100;
export const BEYOND_INPUT_BUDGET_REASON = "beyond_input_character_budget";
export const BEYOND_CONTEXT_WINDOW_REASON = "beyond_context_window";
export const OUTSIDE_LOOKBACK_REASON = "outside_lookback_window";

export interface SentPost {
  post: Post;
  text: string;
  originalChars: number;
  truncated: boolean;
  /** `quote.text` cut at 500 characters. Present when that field was a string. */
  quoteContext?: string;
  quoteContextOriginalChars?: number;
  quoteContextTruncated?: boolean;
}

export interface AnalysisInputPlan {
  records: AnalysisInputRecord[];
  sent: SentPost[];
}

export interface AnalysisInputOptions {
  inputMaxChars?: number;
  lookbackCutoffMs?: number;
}

/** Chronological order. Falls back to the raw timestamp string when parsing fails. */
export function comparePostTime(a: Post, b: Post): number {
  return compareTimestamp(a.timestamp, a.id, b.timestamp, b.id);
}

/** Chronological order for a timestamp plus a stable id tie-break. */
export function compareTimestamp(
  aTimestamp: string,
  aId: string,
  bTimestamp: string,
  bId: string,
): number {
  const aMs = Date.parse(aTimestamp);
  const bMs = Date.parse(bTimestamp);
  const aOk = Number.isFinite(aMs);
  const bOk = Number.isFinite(bMs);
  if (aOk && bOk && aMs !== bMs) return aMs - bMs;
  return aTimestamp.localeCompare(bTimestamp) || aId.localeCompare(bId);
}

function eligibleText(post: Post): string | null {
  if (post.typeConflict === "retweet_and_quote") return null;
  if (post.kind === "original") return post.text;
  if (post.kind === "quote") {
    const comment = post.analystComment?.trim() ?? "";
    return comment === "" ? null : comment;
  }
  return null;
}

function exclusionReason(post: Post): string {
  if (post.typeConflict === "retweet_and_quote") return "retweet_and_quote";
  if (post.kind === "repost") return "repost";
  if (post.kind === "quote") return "quote_without_analyst_commentary";
  return "ineligible_post";
}

function excerpt(text: string): string {
  return text.slice(0, SENT_TEXT_EXCERPT_CHARS);
}

function countedChars(post: Post): number {
  if (post.kind === "quote") return (post.analystComment ?? "").length;
  return post.text.length;
}

function excluded(
  post: Post,
  reason: string,
  originalChars: number,
): AnalysisInputRecord {
  return {
    postId: post.id,
    timestamp: post.timestamp,
    disposition: "excluded",
    reason,
    originalChars,
    sentChars: 0,
  };
}

function pastLookback(post: Post, cutoffMs: number | undefined): boolean {
  if (cutoffMs === undefined) return false;
  const ms = Date.parse(post.timestamp);
  return Number.isFinite(ms) && ms < cutoffMs;
}

/**
 * Choose model input from a retrieved slice.
 * Posts are ordered by parsed timestamp, newest first.
 * Originals and quotes with commentary inside the lookback window are eligible.
 * Each post is cut at 1,000 characters. A sent quote also includes `quote.text`,
 * cut at 500 characters, and that context counts toward the same character budget.
 * Eligible posts are sent until the budget is used up. A post that does not fit,
 * and every later eligible post, is listed as excluded.
 */
export function planAnalysisInput(
  posts: Post[],
  handle: string,
  options: AnalysisInputOptions = {},
): AnalysisInputPlan {
  const budget =
    options.inputMaxChars !== undefined &&
    Number.isSafeInteger(options.inputMaxChars) &&
    options.inputMaxChars >= 1
      ? options.inputMaxChars
      : LLM_INPUT_MAX_CHARS;
  const ordered = [...posts].sort((a, b) => comparePostTime(b, a));
  const records: AnalysisInputRecord[] = [];
  const sent: SentPost[] = [];
  let used = 0;
  let budgetClosed = false;

  for (const post of ordered) {
    if (post.authorHandle !== handle) {
      records.push(excluded(post, "author_mismatch", post.text.length));
      continue;
    }
    if (pastLookback(post, options.lookbackCutoffMs)) {
      records.push(excluded(post, OUTSIDE_LOOKBACK_REASON, countedChars(post)));
      continue;
    }
    const full = eligibleText(post);
    if (full === null) {
      records.push(excluded(post, exclusionReason(post), countedChars(post)));
      continue;
    }
    const truncated = full.length > LLM_MAX_POST_CHARS;
    const text = truncated ? full.slice(0, LLM_MAX_POST_CHARS) : full;
    const quote = post.kind === "quote";
    const quoteOriginal =
      quote && typeof post.quotedPostText === "string" ? post.quotedPostText : undefined;
    const quoteContext =
      quoteOriginal === undefined
        ? undefined
        : quoteOriginal.slice(0, LLM_MAX_QUOTE_CONTEXT_CHARS);
    const quoteContextTruncated =
      quoteOriginal !== undefined && quoteOriginal.length > LLM_MAX_QUOTE_CONTEXT_CHARS;
    const quoteChars = quoteContext?.length ?? 0;
    if (budgetClosed || used + text.length + quoteChars > budget) {
      budgetClosed = true;
      records.push(excluded(post, BEYOND_INPUT_BUDGET_REASON, full.length));
      continue;
    }
    used += text.length + quoteChars;
    records.push({
      postId: post.id,
      timestamp: post.timestamp,
      disposition: truncated ? "truncated" : "sent",
      reason: truncated
        ? quote
          ? "quote_commentary_truncated"
          : "original_truncated"
        : quote
          ? "quote_commentary"
          : "original",
      originalChars: full.length,
      sentChars: text.length,
      sentExcerpt: excerpt(text),
      ...(quoteOriginal !== undefined ? { quotedPostExcerpt: excerpt(quoteOriginal) } : {}),
    });
    sent.push({
      post,
      text,
      originalChars: full.length,
      truncated,
      ...(quoteContext !== undefined
        ? {
            quoteContext,
            quoteContextOriginalChars: quoteOriginal?.length ?? 0,
            quoteContextTruncated,
          }
        : {}),
    });
  }

  return { records, sent };
}
