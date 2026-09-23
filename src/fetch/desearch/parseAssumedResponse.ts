import type { Post, PostKind } from "../../types.js";
import type { AssumedDesearchPostItem } from "./assumedApiTypes.js";

export type ParseResult =
  | {
      ok: true;
      posts: Post[];
      /** Assumed API indicates additional pages exist (verify with official docs). */
      hasMore: boolean;
      nextCursor: string | undefined;
    }
  | { ok: false; reason: string };

const LIST_KEYS = ["posts", "tweets", "data"] as const;

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
 * Post kind policy (assumed API — verify later):
 * - Use explicit `post_kind` when valid.
 * - Else infer from is_retweet / is_quote booleans.
 * - Else treat as `original` (conservative; do not infer repost/quote without signals).
 */
function resolvePostKind(item: AssumedDesearchPostItem): PostKind {
  if (item.post_kind === "original" || item.post_kind === "repost" || item.post_kind === "quote") {
    return item.post_kind;
  }
  if (item.is_retweet === true) return "repost";
  if (item.is_quote === true) return "quote";
  return "original";
}

function mapItem(
  expectedHandle: string,
  item: unknown,
  index: number,
): { ok: true; post: Post } | { ok: false; reason: string } {
  if (!isRecord(item)) {
    return { ok: false, reason: `item ${index}: not an object` };
  }
  const raw = item as unknown as AssumedDesearchPostItem;
  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    return { ok: false, reason: `item ${index}: missing post id` };
  }
  if (typeof raw.text !== "string" || raw.text.trim() === "") {
    return { ok: false, reason: `item ${index}: missing post text` };
  }
  if (typeof raw.created_at !== "string" || !validateTimestamp(raw.created_at)) {
    return { ok: false, reason: `item ${index}: invalid timestamp` };
  }
  if (typeof raw.url !== "string" || !validatePostUrl(raw.url)) {
    return { ok: false, reason: `item ${index}: invalid url` };
  }
  if (typeof raw.username !== "string" || raw.username.trim() === "") {
    return { ok: false, reason: `item ${index}: missing author handle` };
  }
  const authorHandle = raw.username.trim().toLowerCase();
  if (authorHandle !== expectedHandle) {
    return { ok: false, reason: `item ${index}: author handle mismatch` };
  }

  if (raw.is_retweet === true && raw.is_quote === true) {
    return { ok: false, reason: `item ${index}: conflicting repost and quote flags` };
  }

  const kind = resolvePostKind(raw);
  const post: Post = {
    id: raw.id.trim(),
    authorHandle,
    text: raw.text,
    timestamp: raw.created_at,
    url: raw.url.trim(),
    kind,
  };
  if (kind === "quote" && typeof raw.quote_comment === "string" && raw.quote_comment.trim()) {
    post.analystComment = raw.quote_comment;
  }
  return { ok: true, post };
}

function extractListPayload(payload: unknown):
  | { ok: true; items: unknown[]; hasMore: boolean; nextCursor: string | undefined }
  | { ok: false; reason: string } {
  if (!isRecord(payload)) {
    return { ok: false, reason: "top-level response is not an object" };
  }

  let listKey: (typeof LIST_KEYS)[number] | undefined;
  for (const key of LIST_KEYS) {
    if (key in payload) {
      if (listKey !== undefined) {
        return { ok: false, reason: "conflicting list fields in response" };
      }
      listKey = key;
    }
  }
  if (listKey === undefined) {
    return { ok: false, reason: "unrecognized assumed response shape" };
  }

  const rawList = payload[listKey];
  if (!Array.isArray(rawList)) {
    return { ok: false, reason: `${listKey} is not an array` };
  }

  let hasMore = false;
  if ("has_more" in payload) {
    if (typeof payload.has_more !== "boolean") {
      return { ok: false, reason: "has_more must be boolean when present" };
    }
    hasMore = payload.has_more;
  }

  let nextCursor: string | undefined;
  if ("next_cursor" in payload) {
    const c = payload.next_cursor;
    if (c !== null && c !== undefined && typeof c !== "string") {
      return { ok: false, reason: "next_cursor must be a string when present" };
    }
    nextCursor = typeof c === "string" && c.trim() !== "" ? c : undefined;
  }

  if (hasMore && !nextCursor) {
    return { ok: false, reason: "has_more true but next_cursor missing" };
  }

  return { ok: true, items: rawList, hasMore, nextCursor };
}

/**
 * Map assumed Desearch JSON to internal posts. External fields are untrusted.
 */
export function parseAssumedDesearchResponse(
  expectedHandle: string,
  payload: unknown,
): ParseResult {
  const top = extractListPayload(payload);
  if (!top.ok) return top;

  if (top.items.length === 0) {
    return { ok: true, posts: [], hasMore: top.hasMore, nextCursor: top.nextCursor };
  }

  const posts: Post[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < top.items.length; i++) {
    const mapped = mapItem(expectedHandle, top.items[i], i);
    if (!mapped.ok) return mapped;
    if (seenIds.has(mapped.post.id)) {
      return { ok: false, reason: `duplicate post id ${mapped.post.id}` };
    }
    seenIds.add(mapped.post.id);
    posts.push(mapped.post);
  }

  return {
    ok: true,
    posts,
    hasMore: top.hasMore,
    nextCursor: top.nextCursor,
  };
}
