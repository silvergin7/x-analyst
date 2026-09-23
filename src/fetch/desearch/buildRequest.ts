/** Assumed base URL — confirm with official Desearch docs before live use. */
export const ASSUMED_DESEARCH_API_BASE = "https://api.desearch.ai";

export interface DesearchPostsRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}

/**
 * Build a request descriptor for per-handle post retrieval (no network I/O).
 * Authorization header value must never be logged or included in error messages.
 */
export function buildDesearchPostsRequest(
  handle: string,
  maxPosts: number,
  apiKey: string,
  cursor?: string,
): DesearchPostsRequest {
  const url = new URL(`${ASSUMED_DESEARCH_API_BASE}/v1/posts/by-handle`);
  url.searchParams.set("handle", handle);
  url.searchParams.set("limit", String(maxPosts));
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  return {
    method: "GET",
    url: url.toString(),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };
}

/** Read requested limit from a built request URL (for tests). */
export function readRequestLimit(request: DesearchPostsRequest): number {
  return Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "0", 10);
}
