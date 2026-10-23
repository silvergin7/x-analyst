import type { RunReportResult } from "../runReport.js";

export function serializeRunReportResult(
  question: string,
  result: RunReportResult,
  outputPath: string,
): string {
  return JSON.stringify(
    {
      question,
      outputPath,
      ...result,
    },
    null,
    2,
  );
}
