import type { Post, PostKind } from "../../types.js";
import type { DesearchTwitterPostItem } from "./assumedApiTypes.js";

export type ParseResult =
  | {
      ok: true;
      posts: Post[];
      /** True when response includes a non-empty next_cursor (more pages may exist). */
      hasMorePages: boolean;
      nextCursor: string | undefined;
    }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateTimestamp(value: string): boolean {
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function validatePostUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Classify post kind from documented booleans only.
 * Missing flags are rejected and never default to original.
 * Both flags true keeps the post as a repost with typeConflict set, so one
 * mixed item does not discard the rest of the response.
 */
function resolvePostKind(
  item: DesearchTwitterPostItem,
  index: number,
):
  | { ok: true; kind: PostKind; typeConflict?: "retweet_and_quote" }
  | { ok: false; reason: string } {
  if (typeof item.is_retweet !== "boolean" || typeof item.is_quote_tweet !== "boolean") {
    return {
      ok: false,
      reason: `item ${index}: is_retweet and is_quote_tweet must be booleans`,
    };
  }
  if (item.is_retweet === true && item.is_quote_tweet === true) {
    return { ok: true, kind: "repost", typeConflict: "retweet_and_quote" };
  }
  if (item.is_retweet === true) return { ok: true, kind: "repost" };
  if (item.is_quote_tweet === true) return { ok: true, kind: "quote" };
  return { ok: true, kind: "original" };
}

/**
 * The documented response example nests the quoted tweet at `quote`.
 * Use `quote.text` only when it is a string. Do not read another field as the quoted post.
 */
function readQuotedPostText(item: Record<string, unknown>): string | undefined {
  if (!isRecord(item.quote) || typeof item.quote.text !== "string") return undefined;
  return item.quote.text;
}

function mapTweet(
  expectedUsername: string,
  item: unknown,
  index: number,
): { ok: true; post: Post } | { ok: false; reason: string } {
  if (!isRecord(item)) {
    return { ok: false, reason: `item ${index}: not an object` };
  }
  const raw = item as unknown as DesearchTwitterPostItem;
  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    return { ok: false, reason: `item ${index}: missing tweet id` };
  }
  if (typeof raw.text !== "string") {
    return { ok: false, reason: `item ${index}: missing tweet text` };
  }
  if (typeof raw.created_at !== "string" || !validateTimestamp(raw.created_at)) {
    return { ok: false, reason: `item ${index}: invalid timestamp` };
  }
  if (typeof raw.url !== "string" || !validatePostUrl(raw.url)) {
    return { ok: false, reason: `item ${index}: invalid url` };
  }
  if (!isRecord(raw.user) || typeof raw.user.username !== "string") {
    return { ok: false, reason: `item ${index}: missing tweet.user.username` };
  }
  const authorHandle = raw.user.username.trim().toLowerCase();
  if (authorHandle !== expectedUsername) {
    return { ok: false, reason: `item ${index}: author username mismatch` };
  }

  const kindResult = resolvePostKind(raw, index);
  if (!kindResult.ok) return kindResult;

  const ownText = raw.text.trim();
  const pureQuote = kindResult.kind === "quote" && !kindResult.typeConflict;
  if (ownText === "" && !pureQuote) {
    return { ok: false, reason: `item ${index}: missing tweet text` };
  }

  const post: Post = {
    id: raw.id.trim(),
    authorHandle,
    text: raw.text,
    timestamp: raw.created_at,
    url: raw.url.trim(),
    kind: kindResult.kind,
  };
  if (kindResult.typeConflict) post.typeConflict = kindResult.typeConflict;
  if (pureQuote && ownText !== "") post.analystComment = ownText;
  const quotedPostText = readQuotedPostText(item);
  if (quotedPostText !== undefined) post.quotedPostText = quotedPostText;
  return { ok: true, post };
}

function readNextCursor(
  payload: Record<string, unknown>,
):
  | { ok: true; hasMorePages: boolean; nextCursor: string | undefined }
  | { ok: false; reason: string } {
  if (!("next_cursor" in payload)) {
    return { ok: true, hasMorePages: false, nextCursor: undefined };
  }
  const c = payload.next_cursor;
  if (c === null || c === undefined || c === "") {
    return { ok: true, hasMorePages: false, nextCursor: undefined };
  }
  if (typeof c !== "string") {
    return { ok: false, reason: "next_cursor must be a string when present" };
  }
  const trimmed = c.trim();
  if (trimmed === "") {
    return { ok: true, hasMorePages: false, nextCursor: undefined };
  }
  return { ok: true, hasMorePages: true, nextCursor: trimmed };
}

/**
 * Map documented GET /twitter/user/posts JSON to internal posts.
 */
export function parseTwitterUserPostsResponse(
  expectedUsername: string,
  payload: unknown,
): ParseResult {
  if (!isRecord(payload)) {
    return { ok: false, reason: "top-level response is not an object" };
  }
  if (!("tweets" in payload)) {
    return { ok: false, reason: "missing tweets array" };
  }
  if (!Array.isArray(payload.tweets)) {
    return { ok: false, reason: "tweets is not an array" };
  }

  const cursorResult = readNextCursor(payload);
  if (!cursorResult.ok) return cursorResult;
  const { hasMorePages, nextCursor } = cursorResult;

  if (payload.tweets.length === 0) {
    return { ok: true, posts: [], hasMorePages, nextCursor };
  }

  const posts: Post[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < payload.tweets.length; i++) {
    const mapped = mapTweet(expectedUsername, payload.tweets[i], i);
    if (!mapped.ok) return mapped;
    if (seenIds.has(mapped.post.id)) {
      return { ok: false, reason: `duplicate post id ${mapped.post.id}` };
    }
    seenIds.add(mapped.post.id);
    posts.push(mapped.post);
  }

  return { ok: true, posts, hasMorePages, nextCursor };
}

/** @deprecated Use parseTwitterUserPostsResponse. */
export const parseAssumedDesearchResponse = parseTwitterUserPostsResponse;
