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
   * Text of the quoted post from Desearch `quote.text`, when that field is a string.
   * Never sent as the analyst's words.
   */
  quotedPostText?: string;
  /**
   * Both Desearch kind flags were true. The post is kept as a repost and
   * withheld from outlook text.
   */
  typeConflict?: "retweet_and_quote";
  /**
   * The documented `tweets[].media` array was non-empty.
   * Item fields such as type are not documented, so this is attached media,
   * not a claim that every item is a photo.
   */
  hasAttachedMedia?: boolean;
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
  | "desearch_request_budget_exhausted"
  | "desearch_handle_request_limit_reached"
  | "desearch_page_no_valid_posts"
  | "desearch_retrieval_interrupted";

/**
 * Why Desearch stopped requesting another page for one handle.
 * The request budget is the only one of these that leaves retrieval incomplete.
 */
export type FetchStopReason =
  | "lookback_window_reached"
  | "no_more_pages"
  | "desearch_request_budget_exhausted"
  | "desearch_handle_request_limit_reached";

export type PostSource = "fixtures" | "desearch";

export type AnalysisProviderLabel = "mock-rules" | "chutes";

export type DesearchFailureCategory =
  | "http_status"
  | "timeout"
  | "network"
  | "invalid_json"
  | "parse";

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
      /** Exact reason the last page request stopped. Present for Desearch slices. */
      fetchStopReason?: FetchStopReason;
      /** Copies of a post id dropped because a later page repeated it. */
      duplicatePostsRemoved?: number;
      /** Invalid items skipped inside Desearch responses, by reason code. */
      invalidPostsSkipped?: Record<string, number>;
      /** Present when retrieval stopped on an error but partial posts were kept. */
      failureCategory?: DesearchFailureCategory;
      httpStatus?: number;
      reason?: string;
    }
  | {
      status: "incomplete";
      handle: string;
      reason: FetchIncompleteReason;
    }
  | { status: "unknown_handle"; handle: string }
  | { status: "invalid_handle"; handle: string; reason: string }
  | { status: "empty"; handle: string }
  | {
      status: "retrieval_failed";
      handle: string;
      failureCategory: DesearchFailureCategory;
      httpStatus?: number;
      reason: string;
    };

export type FetchOutcome = FetchOutcomeShape & {
  billing?: DesearchBilling[];
};

export type MarketOutlook =
  | "bullish"
  | "bearish"
  | "cautious"
  | "mixed"
  | "unclear";

export type AssetClass =
  | "equities"
  | "rates_bonds"
  | "crypto"
  | "commodities"
  | "fx"
  | "macro"
  | "none";

export type Stance = "bullish" | "bearish" | "neutral" | "unclear";

export interface PostClassification {
  postId: string;
  relevant: boolean;
  assetClass: AssetClass;
  stance: Stance;
  reason: string;
}

export interface AssetClassOutlook {
  assetClass: Exclude<AssetClass, "none">;
  outlook: MarketOutlook;
  evidence: EvidenceRef[];
  newestRelevantPostAt: string;
  viewMayBeStale: boolean;
}

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
  fetchStopReason?: FetchStopReason;
  /** When set, posts older than this instant are outside the lookback window. */
  lookbackCutoffMs?: number;
  /** Total characters of eligible post text that may be sent. */
  inputMaxChars?: number;
  duplicatePostsRemoved?: number;
  invalidPostsSkipped?: Record<string, number>;
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
  /** Eligible posts in the window, including those left out by the character budget or context window. */
  eligiblePostCount?: number;
  /** Posts the model classified as relevant. */
  relevantPostCount?: number;
  /** Timestamp of the newest post classified as relevant. */
  newestRelevantPostAt?: string;
  /** True when that newest relevant post is older than 14 days before the reference date. */
  viewMayBeStale?: boolean;
  fetchStopReason?: FetchStopReason;
  /** One judgment for every post sent to the model. */
  classifications?: PostClassification[];
  /** Outlook for each asset class that has relevant posts. */
  assetOutlooks?: AssetClassOutlook[];
  /** Repeated post ids dropped across Desearch pages. */
  duplicatePostsRemoved?: number;
  /** Invalid Desearch items skipped during retrieval, by reason code. */
  invalidPostsSkipped?: Record<string, number>;
  /** Retrieved posts whose documented media array was non-empty. */
  postsWithMedia?: number;
  /** Model explanation was cut to the configured character limit. */
  explanationTruncated?: boolean;
  /** Evidence citations dropped because the post was unclassified or invalid. */
  evidenceDroppedUnclassified?: number;
  /** Asset-class outlooks removed after citation checks. */
  assetOutlooksDropped?: Exclude<AssetClass, "none">[];
}

/** One retrieved post as included, truncated, or left out of model input. */
export interface AnalysisInputRecord {
  postId: string;
  /** Timestamp of the retrieved post. */
  timestamp: string;
  disposition: "sent" | "truncated" | "excluded";
  reason: string;
  originalChars: number;
  sentChars: number;
  /** First 100 characters of the text actually sent. Present on sent and truncated posts. */
  sentExcerpt?: string;
  /** First 100 characters of Desearch `quote.text`. Present on sent quotes when that field was a string. */
  quotedPostExcerpt?: string;
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
  basis: "qwen3-tokenizer-conservative";
  messageTokens?: number;
  responseFormatTokens?: number;
  calibrationMarginTokens?: number;
}

export interface AnalysisQuestion {
  text: string;
}
