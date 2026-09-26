/** Kind of post as supplied by the data source (fixture or future Desearch). */
export type PostKind = "original" | "repost" | "quote";

/** A single post attributed to an analyst handle. */
export interface Post {
  id: string;
  authorHandle: string;
  text: string;
  timestamp: string;
  url: string;
  kind: PostKind;
  /** For quotes: the analyst's own commentary, if any. */
  analystComment?: string;
}

/** Configurable caps for retrieval (mock and future live fetch). */
export interface FetchLimits {
  maxPostsPerPerson: number;
  maxPostsTotal: number;
}

/** Machine-readable reason when retrieval did not cover all available posts. */
export type FetchIncompleteReason =
  | "total_post_limit_reached"
  | "per_person_limit_reached"
  | "desearch_request_budget_exhausted";

export type FetchOutcome =
  | {
      status: "ok";
      handle: string;
      posts: Post[];
      retrievalComplete: boolean;
      incompleteReason?: FetchIncompleteReason;
    }
  | {
      status: "incomplete";
      handle: string;
      reason: "total_post_limit_reached" | "desearch_request_budget_exhausted";
    }
  | { status: "unknown_handle"; handle: string }
  | { status: "invalid_handle"; handle: string; reason: string }
  | { status: "empty"; handle: string };

export type MarketOutlook =
  | "bullish"
  | "bearish"
  | "cautious"
  | "unclear";

export interface EvidenceRef {
  postId: string;
  url: string;
  timestamp: string;
  kind: PostKind;
}

/** Context from fetch step passed into analysis for honest coverage reporting. */
export interface RetrievalContext {
  retrievalComplete: boolean;
  incompleteReason?: FetchIncompleteReason;
}

export interface PersonOutlookReport {
  handle: string;
  outlook: MarketOutlook;
  explanation: string;
  dateRangeExamined: { from: string; to: string } | null;
  /** Count of posts in the retrieved slice used for this report. */
  postsExamined: number;
  retrievalComplete: boolean;
  retrievalIncompleteReason?: FetchIncompleteReason;
  evidence: EvidenceRef[];
  /** True when analysis used mock rules, not an LLM. */
  analysisSource: "mock";
}

export interface AnalysisQuestion {
  text: string;
}
