import type { BudgetEstimate, PersonOutlookReport, ProviderTokenUsage } from "../types.js";

function usd(amount: number): string {
  return `$${amount.toFixed(6)}`;
}

export function formatProviderUsage(usage: ProviderTokenUsage): string {
  return (
    `Provider usage: prompt_tokens=${usage.promptTokens} ` +
    `completion_tokens=${usage.completionTokens} total_tokens=${usage.totalTokens}`
  );
}

function usageLine(
  report: PersonOutlookReport,
  usage: ProviderTokenUsage | null | undefined,
): string {
  if (!report.modelInvoked) return "  Provider usage: no request was sent";
  if (usage == null) return "  Provider usage: not reported";
  return `  ${formatProviderUsage(usage)}`;
}

/** Print one opt-in LLM report. Retrieval coverage stays separate from analysis input. */
export function formatLlmFixtureReport(report: PersonOutlookReport): string {
  const lines: string[] = [];
  if (report.analysisReferenceDate) {
    lines.push(
      `Synthetic fixture test. Analysis reference date: ${report.analysisReferenceDate}. These posts are not current real-world research.`,
    );
  }
  lines.push(`@${report.handle}`);
  lines.push(
    `  Outlook: ${report.outlook} (source: ${report.analysisSource}, model invoked: ${report.modelInvoked ? "yes" : "no"})`,
  );
  lines.push(`  Posts sent to the model: ${report.postsExamined}`);
  if (report.dateRangeExamined) {
    lines.push(
      `  Date range of retrieved slice: ${report.dateRangeExamined.from} → ${report.dateRangeExamined.to}`,
    );
  } else {
    lines.push("  Date range of retrieved slice: none");
  }
  if (!report.retrievalComplete && report.retrievalIncompleteReason) {
    lines.push(
      `  Retrieval coverage: incomplete (${report.retrievalIncompleteReason})`,
    );
  } else {
    lines.push("  Retrieval coverage: complete for the fetched slice");
  }
  lines.push(`  Explanation: ${report.explanation}`);
  if (report.budgetEstimate) {
    lines.push(`  ${formatBudgetEstimate(report.budgetEstimate)}`);
  }
  lines.push(usageLine(report, report.providerUsage));
  lines.push("  Analysis input:");
  for (const record of report.analysisInput ?? []) {
    lines.push(
      `    - ${record.postId} ${record.timestamp} ${record.disposition} (${record.reason}); originalChars=${record.originalChars} sentChars=${record.sentChars}`,
    );
  }
  if (report.evidence.length === 0) {
    lines.push("  Evidence: none");
  } else {
    lines.push("  Evidence (metadata copied from supplied posts):");
    for (const item of report.evidence) {
      lines.push(
        `    - ${item.postId} [${item.kind}] ${item.timestamp} ${item.url}`,
      );
    }
  }
  return lines.join("\n");
}

export function formatBudgetEstimate(estimate: BudgetEstimate): string {
  return (
    `Pessimistic estimate ${usd(estimate.estimatedUsd)} ` +
    `(input ceiling ${estimate.inputTokensUpper} tokens, output ceiling ${estimate.outputTokensUpper} tokens, ` +
    `${estimate.basis}). This is not provider-reported usage.`
  );
}
