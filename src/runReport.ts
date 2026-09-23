import { MockOutlookAnalyzer } from "./analyze/outlookAnalyzer.js";
import { loadFetchLimits } from "./config.js";
import { createCliPostsFetcher } from "./fetch/createPostsFetcher.js";
import type { AnalysisQuestion, PersonOutlookReport } from "./types.js";
import type { FetchOutcome } from "./types.js";

export interface RunReportResult {
  fetchOutcomes: FetchOutcome[];
  reports: PersonOutlookReport[];
}

/**
 * Orchestrates mock fetch + mock analysis. CLI always uses mock posts (see createCliPostsFetcher).
 */
export async function runReport(
  handles: string[],
  question: AnalysisQuestion,
): Promise<RunReportResult> {
  const limits = loadFetchLimits();
  const fetcher = createCliPostsFetcher();
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
