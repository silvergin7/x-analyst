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
  /**
   * Both Desearch kind flags were true. The post is kept as a repost and
   * withheld from outlook text.
   */
  typeConflict?: "retweet_and_quote";
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

export type PostSource = "fixtures" | "desearch";

export type AnalysisProviderLabel = "mock-rules" | "chutes";

/** Billing fields Desearch actually returned. Missing fields stay missing. */
export interface DesearchBilling {
  costUsd?: number;
  usageCount?: number;
  service?: string;
  currency?: string;
}

type FetchOutcomeShape =
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

export type FetchOutcome = FetchOutcomeShape & {
  billing?: DesearchBilling[];
};

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
  /**
   * Mock reports: posts in the retrieved slice.
   * LLM reports: posts sent to the model, including truncated ones.
   */
  postsExamined: number;
  retrievalComplete: boolean;
  retrievalIncompleteReason?: FetchIncompleteReason;
  evidence: EvidenceRef[];
  /** `mock` is keyword rules. `llm` is the opt-in Chutes analyzer. */
  analysisSource: "mock" | "llm";
  /**
   * How each retrieved post was treated for model input.
   * Present on opt-in LLM reports. Mock reports omit it.
   */
  analysisInput?: AnalysisInputRecord[];
  /** False when the opt-in analyzer returned without calling the model. */
  modelInvoked?: boolean;
  /** Provider-reported token counts. Null means the provider omitted usage. */
  providerUsage?: ProviderTokenUsage | null;
  /** Pessimistic pre-request ceiling. Distinct from providerUsage. */
  budgetEstimate?: BudgetEstimate;
  /** UTC date the opt-in analyzer used for the word "current". */
  analysisReferenceDate?: string;
}

/** One retrieved post as included, truncated, or left out of model input. */
export interface AnalysisInputRecord {
  postId: string;
  disposition: "sent" | "truncated" | "excluded";
  reason: string;
  originalChars: number;
  sentChars: number;
}

/** Token counts reported by the provider after a completed call. */
export interface ProviderTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Local ceiling computed before a request.
 * Not provider-reported usage.
 */
export interface BudgetEstimate {
  inputTokensUpper: number;
  outputTokensUpper: number;
  estimatedUsd: number;
  basis: "pessimistic-utf8-bytes-plus-framing";
}

export interface AnalysisQuestion {
  text: string;
}
