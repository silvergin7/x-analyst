/**
 * TEMPORARY assumed Desearch response shapes for local development only.
 * Verify against official Desearch API documentation after credentials are
 * obtained and before any capped live request is approved.
 */

/** Assumed single post/tweet item in a list response. */
export interface AssumedDesearchPostItem {
  id: string;
  text?: string;
  created_at?: string;
  url?: string;
  username?: string;
  /** Preferred explicit kind when API documents it (assumed — unverified). */
  post_kind?: "original" | "repost" | "quote";
  is_retweet?: boolean;
  is_quote?: boolean;
  quote_comment?: string;
}

/** Assumed top-level list response wrapper. */
export interface AssumedDesearchListResponse {
  posts?: AssumedDesearchPostItem[];
  tweets?: AssumedDesearchPostItem[];
  data?: AssumedDesearchPostItem[];
  has_more?: boolean;
  next_cursor?: string;
}
