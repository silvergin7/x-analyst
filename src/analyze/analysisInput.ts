import {
  LLM_MAX_ELIGIBLE_POSTS,
  LLM_MAX_POST_CHARS,
} from "../config/llmSettings.js";
import type { AnalysisInputRecord, Post } from "../types.js";

export interface SentPost {
  post: Post;
  text: string;
  originalChars: number;
  truncated: boolean;
}

export interface AnalysisInputPlan {
  records: AnalysisInputRecord[];
  sent: SentPost[];
}

/** Chronological order. Falls back to the raw timestamp string when parsing fails. */
export function comparePostTime(a: Post, b: Post): number {
  const aMs = Date.parse(a.timestamp);
  const bMs = Date.parse(b.timestamp);
  const aOk = Number.isFinite(aMs);
  const bOk = Number.isFinite(bMs);
  if (aOk && bOk && aMs !== bMs) return aMs - bMs;
  return a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id);
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

/**
 * Choose model input from a retrieved slice.
 * Original posts send their own text. Quotes send only non-empty analyst commentary.
 * Reposts, quotes without commentary, and posts with both retweet and quote
 * flags are excluded. At most `eligibleCap` eligible posts, most recent first,
 * are sent. The cap never exceeds the model limit of 10.
 */
export function planAnalysisInput(
  posts: Post[],
  handle: string,
  eligibleCap: number = LLM_MAX_ELIGIBLE_POSTS,
): AnalysisInputPlan {
  const cap =
    Number.isSafeInteger(eligibleCap) && eligibleCap >= 1
      ? Math.min(eligibleCap, LLM_MAX_ELIGIBLE_POSTS)
      : LLM_MAX_ELIGIBLE_POSTS;
  const eligible: { post: Post; text: string }[] = [];
  const ineligible = new Set<string>();

  for (const post of posts) {
    if (post.authorHandle !== handle) {
      ineligible.add(post.id);
      continue;
    }
    const text = eligibleText(post);
    if (text === null) {
      ineligible.add(post.id);
      continue;
    }
    eligible.push({ post, text });
  }

  eligible.sort((a, b) => comparePostTime(b.post, a.post));
  const kept = new Set(eligible.slice(0, cap).map((item) => item.post.id));
  const textById = new Map(eligible.map((item) => [item.post.id, item.text]));

  const records: AnalysisInputRecord[] = [];
  const sent: SentPost[] = [];

  for (const post of posts) {
    if (post.authorHandle !== handle) {
      records.push({
        postId: post.id,
        timestamp: post.timestamp,
        disposition: "excluded",
        reason: "author_mismatch",
        originalChars: post.text.length,
        sentChars: 0,
      });
      continue;
    }
    if (ineligible.has(post.id)) {
      const originalChars =
        post.kind === "quote"
          ? (post.analystComment ?? "").length
          : post.text.length;
      records.push({
        postId: post.id,
        timestamp: post.timestamp,
        disposition: "excluded",
        reason: exclusionReason(post),
        originalChars,
        sentChars: 0,
      });
      continue;
    }
    if (!kept.has(post.id)) {
      const text = textById.get(post.id) ?? "";
      records.push({
        postId: post.id,
        timestamp: post.timestamp,
        disposition: "excluded",
        reason: "beyond_analysis_post_cap",
        originalChars: text.length,
        sentChars: 0,
      });
      continue;
    }

    const full = textById.get(post.id) ?? "";
    const truncated = full.length > LLM_MAX_POST_CHARS;
    const text = truncated ? full.slice(0, LLM_MAX_POST_CHARS) : full;
    const quote = post.kind === "quote";
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
    });
    sent.push({ post, text, originalChars: full.length, truncated });
  }

  return { records, sent };
}
