/**
 * Shapes aligned with Desearch GET /twitter/user/posts (see official API reference).
 * Used for parsing only; external JSON is untrusted.
 */

/** Tweet item as documented under response `tweets`. */
export interface DesearchTwitterPostItem {
  id: string;
  text?: string;
  created_at?: string;
  url?: string;
  is_retweet?: boolean;
  is_quote_tweet?: boolean;
  /** Documented nested quoted tweet. Its text is not the analyst's commentary. */
  quote?: {
    text?: string;
  };
  user?: {
    username?: string;
  };
}

/** Documented top-level object for user posts. */
export interface DesearchTwitterUserPostsResponse {
  tweets?: DesearchTwitterPostItem[];
  next_cursor?: string;
  user?: unknown;
}
