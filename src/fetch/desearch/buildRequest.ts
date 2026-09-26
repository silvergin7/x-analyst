/** Documented Desearch API base URL. */
export const DESEARCH_API_BASE = "https://api.desearch.ai";

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
): DesearchPostsRequest {
  const url = new URL(`${DESEARCH_API_BASE}${TWITTER_USER_POSTS_PATH}`);
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
