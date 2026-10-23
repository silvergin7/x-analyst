import { UNCLASSIFIED_BY_MODEL_REASON } from "../analyze/classification.js";
import { desearchListPriceUsd } from "../config/desearchSettings.js";
import { FETCH_STOP_LABEL, STALE_RELEVANT_POST_DAYS } from "../config/timeWindow.js";
import type { HandleAnalysisFailure, ReportFailureDetails } from "../runReport.js";
import { formatBudgetEstimate, formatProviderUsage } from "./llmFixtureReport.js";
import type {
  AnalysisProviderLabel,
  DesearchBilling,
  FetchOutcome,
  PersonOutlookReport,
  PostSource,
} from "../types.js";

const BANNER =
  "=== MOCK RUN — fictional fixture posts and rule-based analysis; no live X or API calls ===";

const INCOMPLETE_REASON_LABEL: Record<string, string> = {
  total_post_limit_reached: "configured total post limit reached before full retrieval",
  per_person_limit_reached: "configured per-person post limit reached",
  desearch_request_budget_exhausted:
    "run Desearch HTTP request limit reached before full pagination (not a dollar cap)",
  desearch_handle_request_limit_reached:
    "per-handle Desearch HTTP request limit reached before full pagination (not a dollar cap)",
};

export function formatFetchIssue(
  outcome: FetchOutcome,
  postsSource: PostSource = "fixtures",
): string {
  switch (outcome.status) {
    case "invalid_handle":
      return `  [!] Invalid handle "${outcome.handle}": ${outcome.reason}`;
    case "unknown_handle":
      return postsSource === "desearch"
        ? `  [!] Unknown handle "${outcome.handle}" (not returned by retrieval)`
        : `  [!] Unknown handle "${outcome.handle}" (not in fixture catalog)`;
    case "empty":
      return postsSource === "desearch"
        ? `  [!] No posts for "${outcome.handle}" in the retrieved slice`
        : `  [!] No posts for "${outcome.handle}" in fixtures`;
    case "incomplete":
      return (
        `  [!] Incomplete retrieval for "@${outcome.handle}": ${outcome.reason} — ` +
        "analyst was not examined (no outlook inferred)"
      );
    case "ok": {
      const stop = outcome.fetchStopReason
        ? `Fetch stopped: ${FETCH_STOP_LABEL[outcome.fetchStopReason]}`
        : "";
      if (!outcome.retrievalComplete && outcome.incompleteReason) {
        const label =
          INCOMPLETE_REASON_LABEL[outcome.incompleteReason] ??
          outcome.incompleteReason;
        const partial =
          `  [~] Partial retrieval for "@${outcome.handle}": ${label} ` +
          `(${outcome.posts.length} post(s) retrieved)`;
        return stop === "" ? partial : `${partial}\n  ${stop}`;
      }
      if (stop !== "") {
        return (
          `  [ok] "@${outcome.handle}": ${stop} ` +
          `(${outcome.posts.length} post(s) retrieved)`
        );
      }
      return "";
    }
  }
}

export function formatPersonReport(report: PersonOutlookReport): string {
  const lines: string[] = [];
  lines.push(`@${report.handle}`);
  if (report.analysisSource === "llm") {
    lines.push(
      `  Outlook: ${report.outlook} (source: llm, model invoked: ${report.modelInvoked ? "yes" : "no"})`,
    );
  } else {
    lines.push(`  Outlook: ${report.outlook} (source: ${report.analysisSource} rules, not LLM)`);
  }
  lines.push(`  Posts examined: ${report.postsExamined}`);
  if (
    report.eligiblePostCount !== undefined &&
    report.relevantPostCount !== undefined
  ) {
    lines.push(
      `  Relevant posts: ${report.relevantPostCount} of ${report.eligiblePostCount} eligible`,
    );
  }
  if (report.newestRelevantPostAt) {
    lines.push(`  Newest relevant post: ${report.newestRelevantPostAt}`);
  }
  const unclassified =
    report.classifications?.filter((item) => item.reason === UNCLASSIFIED_BY_MODEL_REASON) ??
    [];
  if (unclassified.length > 0) {
    lines.push(
      `  Unclassified by model: ${unclassified.map((item) => item.postId).join(", ")}`,
    );
  }
  if (report.viewMayBeStale && !report.assetOutlooks?.some((item) => item.viewMayBeStale)) {
    lines.push(
      `  The newest relevant post is older than ${STALE_RELEVANT_POST_DAYS} days. The view may be stale.`,
    );
  }
  if (report.duplicatePostsRemoved !== undefined && report.duplicatePostsRemoved > 0) {
    lines.push(`  Duplicate post ids removed: ${report.duplicatePostsRemoved}`);
  }
  if (report.postsWithMedia !== undefined) {
    lines.push(`  Posts with media: ${report.postsWithMedia}`);
  }
  if (report.assetOutlooks && report.assetOutlooks.length > 0) {
    lines.push("  Asset outlooks:");
    for (const item of report.assetOutlooks) {
      lines.push(
        `    - ${item.assetClass}: ${item.outlook}. Newest relevant post: ${item.newestRelevantPostAt}`,
      );
      if (item.viewMayBeStale) {
        lines.push(
          `      ${item.assetClass}: The newest relevant post is older than ${STALE_RELEVANT_POST_DAYS} days. The view may be stale.`,
        );
      }
      const cited = item.evidence.map((evidence) => evidence.postId).join(", ");
      lines.push(`      Cited relevant posts: ${cited === "" ? "none" : cited}`);
    }
  }
  if (report.fetchStopReason) {
    lines.push(`  Fetch stopped: ${FETCH_STOP_LABEL[report.fetchStopReason]}`);
  }
  if (!report.retrievalComplete && report.retrievalIncompleteReason) {
    const label =
      INCOMPLETE_REASON_LABEL[report.retrievalIncompleteReason] ??
      report.retrievalIncompleteReason;
    lines.push(`  Coverage: incomplete (${label})`);
  } else {
    lines.push("  Coverage: complete for retrieved slice");
  }
  lines.push(`  Explanation: ${report.explanation}`);
  if (report.dateRangeExamined) {
    lines.push(
      `  Date range of retrieved slice: ${report.dateRangeExamined.from} → ${report.dateRangeExamined.to}`,
    );
  } else {
    lines.push("  Date range of retrieved slice: (none — no posts retrieved)");
  }
  if (report.evidence.length === 0) {
    lines.push("  Evidence: none");
  } else {
    lines.push("  Evidence:");
    for (const e of report.evidence) {
      lines.push(
        `    - ${e.postId} [${e.kind}] ${e.timestamp} ${e.url}`,
      );
    }
  }
  if (report.analysisInput) {
    lines.push("  Analysis input:");
    for (const record of report.analysisInput) {
      lines.push(
        `    - ${record.postId} ${record.timestamp} ${record.disposition} (${record.reason}, ${record.originalChars} -> ${record.sentChars})`,
      );
      if (record.sentExcerpt !== undefined) {
        lines.push(`      Sent text: ${record.sentExcerpt}`);
      }
      if (record.quotedPostExcerpt !== undefined) {
        lines.push(`      Quoted post text: ${record.quotedPostExcerpt}`);
      }
    }
  }
  if (report.analysisSource === "llm") {
    if (report.modelInvoked === false) {
      lines.push("  Provider usage: no request was sent");
    } else if (report.providerUsage) {
      lines.push(`  ${formatProviderUsage(report.providerUsage)}`);
    } else {
      lines.push("  Provider usage: not reported");
    }
    if (report.budgetEstimate) {
      lines.push(
        `  Budget estimate (not provider usage): $${report.budgetEstimate.estimatedUsd.toFixed(6)}`,
      );
    }
    if (report.analysisReferenceDate) {
      lines.push(`  Analysis reference date: ${report.analysisReferenceDate}`);
    }
  }
  return lines.join("\n");
}

export interface ReportRunContext {
  postsSource: PostSource;
  analysisSource: AnalysisProviderLabel;
  referenceDate: string;
  fetchedAt: string;
  fetchedCommit?: string;
  reused: boolean;
  replayed?: boolean;
  billing: DesearchBilling[];
}

function formatBilling(item: DesearchBilling): string {
  const parts: string[] = [];
  if (item.costUsd !== undefined) parts.push(`cost_usd=${item.costUsd}`);
  if (item.usageCount !== undefined) {
    parts.push(`usage_count=${item.usageCount}`);
    parts.push(`list_price_usd=${desearchListPriceUsd(item.usageCount)}`);
  }
  if (item.service !== undefined) parts.push(`service=${item.service}`);
  if (item.currency !== undefined) parts.push(`currency=${item.currency}`);
  return parts.join(" ");
}

/** Failure text only. A failed run does not print a complete report. */
export function formatReportFailure(
  message: string,
  details: ReportFailureDetails,
): string {
  const lines = [message, "The run failed. No complete report was produced."];
  for (const usage of details.providerUsages) {
    lines.push(formatProviderUsage(usage));
  }
  for (const item of details.billing) {
    const line = formatBilling(item);
    if (line.length > 0) lines.push(`Desearch billing: ${line}`);
  }
  if (details.sliceStored && details.fetchedAt) {
    const sliceLabel = details.replayed ? "replayed" : details.reused ? "reused" : "fetched";
    lines.push(
      `Posts source: ${details.postsSource}. Fetched at: ${details.fetchedAt}. Slice: ${sliceLabel}.`,
    );
    if (details.fetchedCommit) {
      lines.push(`Fetched commit: ${details.fetchedCommit}`);
    }
  } else {
    lines.push(`Posts source: ${details.postsSource}. Slice: not stored.`);
  }
  return `${lines.join("\n")}\n`;
}

function bannerFor(context?: ReportRunContext): string {
  if (!context || (context.postsSource === "fixtures" && context.analysisSource === "mock-rules")) {
    return BANNER;
  }
  if (context.postsSource === "fixtures") {
    return "=== FIXTURE POSTS — synthetic fixture data, not current real-world research ===";
  }
  return "=== REPORT RUN — retrieved posts; evidence links come from the retrieval response ===";
}

export function formatFullReport(
  question: string,
  fetchNotes: string[],
  reports: PersonOutlookReport[],
  context?: ReportRunContext,
  handleFailures: HandleAnalysisFailure[] = [],
): string {
  const parts = [bannerFor(context), ""];
  if (context) {
    parts.push(`Posts source: ${context.postsSource}`);
    parts.push(`Analysis source: ${context.analysisSource}`);
    parts.push(`Analysis reference date: ${context.referenceDate}`);
    parts.push(
      context.replayed ? "Slice: replayed" : context.reused ? "Slice: reused" : "Slice: fetched",
    );
    parts.push(`Fetched at: ${context.fetchedAt}`);
    if (context.fetchedCommit) {
      parts.push(`Fetched commit: ${context.fetchedCommit}`);
    }
    for (const item of context.billing) {
      const line = formatBilling(item);
      if (line.length > 0) parts.push(`Desearch billing: ${line}`);
    }
    parts.push("");
  }
  parts.push(`Question: ${question}`, "");
  if (fetchNotes.length > 0) {
    parts.push("Fetch notes:");
    parts.push(...fetchNotes);
    parts.push("");
  }
  parts.push("Per-analyst outlook:");
  parts.push("");
  for (const r of reports) {
    parts.push(formatPersonReport(r));
    parts.push("");
  }
  if (handleFailures.length > 0) {
    parts.push("Analysis failures:");
    parts.push("");
    for (const failure of handleFailures) {
      parts.push(`@${failure.handle}: ${failure.message}`);
      if (failure.budgetEstimate) parts.push(formatBudgetEstimate(failure.budgetEstimate));
      if (failure.providerUsage) parts.push(formatProviderUsage(failure.providerUsage));
    }
    parts.push("");
  }
  return parts.join("\n").trimEnd() + "\n";
}
