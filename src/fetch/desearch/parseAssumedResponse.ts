import type { Post, PostKind } from "../../types.js";
import type { DesearchTwitterPostItem } from "./assumedApiTypes.js";

export type InvalidPostsSkipped = Record<string, number>;

export type ParseResult =
  | {
      ok: true;
      posts: Post[];
      /** True when response includes a non-empty next_cursor (more pages may exist). */
      hasMorePages: boolean;
      nextCursor: string | undefined;
      /** Identical ids dropped inside this page. A different copy fails the response. */
      duplicatesRemoved: number;
      invalidPostsSkipped: InvalidPostsSkipped;
      /** Length of the tweets array in this response. */
      sourceItemCount: number;
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

function incrementSkip(skipped: InvalidPostsSkipped, code: string): void {
  skipped[code] = (skipped[code] ?? 0) + 1;
}

/**
 * Classify post kind from documented booleans only.
 * Missing flags are rejected and never default to original.
 * Both flags true keeps the post as a repost with typeConflict set, so one
 * mixed item does not discard the rest of the response.
 */
function resolvePostKind(
  item: DesearchTwitterPostItem,
):
  | { ok: true; kind: PostKind; typeConflict?: "retweet_and_quote" }
  | { ok: false; skipCode: "invalid_kind_flags" } {
  if (typeof item.is_retweet !== "boolean" || typeof item.is_quote_tweet !== "boolean") {
    return { ok: false, skipCode: "invalid_kind_flags" };
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
): { ok: true; post: Post } | { ok: false; skipCode: string } {
  if (!isRecord(item)) {
    return { ok: false, skipCode: "not_an_object" };
  }
  const raw = item as unknown as DesearchTwitterPostItem;
  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    return { ok: false, skipCode: "missing_tweet_id" };
  }
  if (typeof raw.text !== "string") {
    return { ok: false, skipCode: "missing_tweet_text" };
  }
  if (typeof raw.created_at !== "string" || !validateTimestamp(raw.created_at)) {
    return { ok: false, skipCode: "invalid_timestamp" };
  }
  if (typeof raw.url !== "string" || !validatePostUrl(raw.url)) {
    return { ok: false, skipCode: "invalid_url" };
  }
  if (!isRecord(raw.user) || typeof raw.user.username !== "string") {
    return { ok: false, skipCode: "missing_username" };
  }
  const authorHandle = raw.user.username.trim().toLowerCase();
  if (authorHandle !== expectedUsername) {
    return { ok: false, skipCode: "author_mismatch" };
  }

  const kindResult = resolvePostKind(raw);
  if (!kindResult.ok) return kindResult;

  const ownText = raw.text.trim();
  const pureQuote = kindResult.kind === "quote" && !kindResult.typeConflict;
  if (ownText === "" && !pureQuote) {
    return { ok: false, skipCode: "empty_text" };
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
  if (hasAttachedMedia(item)) post.hasAttachedMedia = true;
  return { ok: true, post };
}

/**
 * The user-posts example includes `tweets[].media` as an array.
 * A non-empty array is attached media. Item fields are not documented,
 * so this does not read type, url, or any other key, and it does not
 * download the media.
 */
function hasAttachedMedia(item: Record<string, unknown>): boolean {
  if (!Object.hasOwn(item, "media")) return false;
  return Array.isArray(item.media) && item.media.length > 0;
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
  const sourceItemCount = payload.tweets.length;

  if (sourceItemCount === 0) {
    return {
      ok: true,
      posts: [],
      hasMorePages,
      nextCursor,
      duplicatesRemoved: 0,
      invalidPostsSkipped: {},
      sourceItemCount: 0,
    };
  }

  const posts: Post[] = [];
  const seen = new Map<string, Post>();
  let duplicatesRemoved = 0;
  const invalidPostsSkipped: InvalidPostsSkipped = {};

  for (let i = 0; i < payload.tweets.length; i++) {
    const mapped = mapTweet(expectedUsername, payload.tweets[i]);
    if (!mapped.ok) {
      incrementSkip(invalidPostsSkipped, mapped.skipCode);
      continue;
    }
    const prior = seen.get(mapped.post.id);
    if (prior) {
      if (!samePageCopy(prior, mapped.post)) {
        return {
          ok: false,
          reason: `duplicate post id ${mapped.post.id} has different content`,
        };
      }
      duplicatesRemoved += 1;
      continue;
    }
    seen.set(mapped.post.id, mapped.post);
    posts.push(mapped.post);
  }

  return {
    ok: true,
    posts,
    hasMorePages,
    nextCursor,
    duplicatesRemoved,
    invalidPostsSkipped,
    sourceItemCount,
  };
}

function samePageCopy(a: Post, b: Post): boolean {
  return (
    a.text === b.text &&
    a.timestamp === b.timestamp &&
    a.url === b.url &&
    a.kind === b.kind &&
    a.typeConflict === b.typeConflict &&
    a.quotedPostText === b.quotedPostText &&
    a.hasAttachedMedia === b.hasAttachedMedia
  );
}

/** @deprecated Use parseTwitterUserPostsResponse. */
export const parseAssumedDesearchResponse = parseTwitterUserPostsResponse;
