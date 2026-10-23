#!/usr/bin/env node
import { parseCliArgs } from "./cliArgs.js";
import { utcReferenceDate } from "./config/llmSettings.js";
import { formatFetchIssue, formatFullReport, formatReportFailure } from "./format/report.js";
import { ReportConfigError, ReportRunError, runReport } from "./runReport.js";

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.flagErrors.length > 0) {
    for (const err of options.flagErrors) {
      process.stderr.write(`Input error: ${err}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const preNotes = options.invalidHandles.map(
    (i) => `  [!] Invalid handle "${i.raw}": ${i.reason}`,
  );

  try {
    const referenceDate = options.asOf ?? utcReferenceDate();
    const result = await runReport(
      options.handles,
      { text: options.question },
      { referenceDate, fresh: options.fresh, replayPath: options.replayPath },
    );

    const fetchNotes = [
      ...preNotes,
      ...result.fetchOutcomes
        .map((outcome) => formatFetchIssue(outcome, result.postsSource))
        .filter((line) => line.length > 0),
    ];

    const output = formatFullReport(options.question, fetchNotes, result.reports, {
      postsSource: result.postsSource,
      analysisSource: result.analysisSource,
      referenceDate: result.referenceDate,
      fetchedAt: result.fetchedAt,
      fetchedCommit: result.fetchedCommit,
      reused: result.reused,
      replayed: result.replayed,
      billing: result.billing,
    });
    process.stdout.write(output);
  } catch (err) {
    if (err instanceof ReportConfigError) {
      process.stderr.write(`${err.message}\n`);
    } else if (err instanceof ReportRunError) {
      process.stderr.write(formatReportFailure(err.message, err.details));
    } else {
      process.stderr.write("Analysis failed unexpectedly\n");
    }
    process.exitCode = 1;
  }
}

main();
