/** Documented Desearch API base URL. */
export const DEFAULT_DESEARCH_API_BASE = "https://api.desearch.ai";

/** @deprecated Use DEFAULT_DESEARCH_API_BASE or loadDesearchApiBase. */
export const DESEARCH_API_BASE = DEFAULT_DESEARCH_API_BASE;

export const TWITTER_USER_POSTS_PATH = "/twitter/user/posts";

export interface DesearchPostsRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}

/**
 * Build GET /twitter/user/posts (no network I/O).
 * Authorization must be the raw API key per official docs — never log it.
 */
export function buildTwitterUserPostsRequest(
  username: string,
  apiKey: string,
  cursor?: string,
  apiBase: string = DEFAULT_DESEARCH_API_BASE,
): DesearchPostsRequest {
  const base = apiBase.replace(/\/+$/, "");
  const url = new URL(`${base}${TWITTER_USER_POSTS_PATH}`);
  url.searchParams.set("username", username);
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  return {
    method: "GET",
    url: url.toString(),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
  };
}

/** @deprecated Use buildTwitterUserPostsRequest. Kept as alias during migration. */
export const buildDesearchPostsRequest = buildTwitterUserPostsRequest;
