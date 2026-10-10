import type { ReportFailureDetails } from "../runReport.js";
import { formatProviderUsage } from "./llmFixtureReport.js";
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
    "Desearch HTTP request budget exhausted before full pagination (not a dollar cap)",
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
    case "ok":
      if (!outcome.retrievalComplete && outcome.incompleteReason) {
        const label =
          INCOMPLETE_REASON_LABEL[outcome.incompleteReason] ??
          outcome.incompleteReason;
        return (
          `  [~] Partial retrieval for "@${outcome.handle}": ${label} ` +
          `(${outcome.posts.length} post(s) retrieved)`
        );
      }
      return "";
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
      `  Date range examined: ${report.dateRangeExamined.from} → ${report.dateRangeExamined.to}`,
    );
  } else {
    lines.push("  Date range examined: (none — no posts retrieved)");
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
        `    - ${record.postId} ${record.disposition} (${record.reason}, ${record.originalChars} -> ${record.sentChars})`,
      );
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
  reused: boolean;
  billing: DesearchBilling[];
}

function formatBilling(item: DesearchBilling): string {
  const parts: string[] = [];
  if (item.costUsd !== undefined) parts.push(`cost_usd=${item.costUsd}`);
  if (item.usageCount !== undefined) parts.push(`usage_count=${item.usageCount}`);
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
    lines.push(
      `Posts source: ${details.postsSource}. Fetched at: ${details.fetchedAt}. Slice: ${details.reused ? "reused" : "fetched"}.`,
    );
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
): string {
  const parts = [bannerFor(context), ""];
  if (context) {
    parts.push(`Posts source: ${context.postsSource}`);
    parts.push(`Analysis source: ${context.analysisSource}`);
    parts.push(`Analysis reference date: ${context.referenceDate}`);
    parts.push(context.reused ? "Slice: reused" : "Slice: fetched");
    parts.push(`Fetched at: ${context.fetchedAt}`);
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
  return parts.join("\n").trimEnd() + "\n";
}
