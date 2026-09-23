import { MockOutlookAnalyzer } from "./analyze/outlookAnalyzer.js";
import { loadFetchLimits } from "./config.js";
import { MockPostsFetcher } from "./fetch/postsFetcher.js";
import type { AnalysisQuestion, PersonOutlookReport } from "./types.js";
import type { FetchOutcome } from "./types.js";

export interface RunReportResult {
  fetchOutcomes: FetchOutcome[];
  reports: PersonOutlookReport[];
}

/**
 * Orchestrates mock fetch + mock analysis. Swap fetcher/analyzer for live APIs later.
 */
export async function runReport(
  handles: string[],
  question: AnalysisQuestion,
): Promise<RunReportResult> {
  const limits = loadFetchLimits();
  const fetcher = new MockPostsFetcher();
  const analyzer = new MockOutlookAnalyzer();

  const fetchOutcomes = await fetcher.fetchForHandles(handles, limits);
  const reports: PersonOutlookReport[] = [];

  for (const outcome of fetchOutcomes) {
    if (outcome.status !== "ok") continue;
    reports.push(
      await analyzer.analyzePerson(outcome.handle, outcome.posts, question, {
        retrievalComplete: outcome.retrievalComplete,
        incompleteReason: outcome.incompleteReason,
      }),
    );
  }

  return { fetchOutcomes, reports };
}
