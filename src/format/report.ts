import type { FetchOutcome, PersonOutlookReport } from "../types.js";

const BANNER =
  "=== MOCK RUN — fictional fixture posts and rule-based analysis; no live X or API calls ===";

const INCOMPLETE_REASON_LABEL: Record<string, string> = {
  total_post_limit_reached: "configured total post limit reached before full retrieval",
  per_person_limit_reached: "configured per-person post limit reached",
  desearch_request_budget_exhausted:
    "Desearch HTTP request budget exhausted before full pagination (not a dollar cap)",
};

export function formatFetchIssue(outcome: FetchOutcome): string {
  switch (outcome.status) {
    case "invalid_handle":
      return `  [!] Invalid handle "${outcome.handle}": ${outcome.reason}`;
    case "unknown_handle":
      return `  [!] Unknown handle "${outcome.handle}" (not in fixture catalog)`;
    case "empty":
      return `  [!] No posts for "${outcome.handle}" in fixtures`;
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
  lines.push(`  Outlook: ${report.outlook} (source: ${report.analysisSource} rules, not LLM)`);
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
  return lines.join("\n");
}

export function formatFullReport(
  question: string,
  fetchNotes: string[],
  reports: PersonOutlookReport[],
): string {
  const parts = [BANNER, "", `Question: ${question}`, ""];
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
