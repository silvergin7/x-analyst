#!/usr/bin/env node
import { parseCliArgs } from "./cliArgs.js";
import { formatFetchIssue, formatFullReport } from "./format/report.js";
import { runReport } from "./runReport.js";

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
    const { fetchOutcomes, reports } = await runReport(options.handles, {
      text: options.question,
    });

    const fetchNotes = [
      ...preNotes,
      ...fetchOutcomes.map(formatFetchIssue).filter((l) => l.length > 0),
    ];

    const output = formatFullReport(options.question, fetchNotes, reports);
    process.stdout.write(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}

main();
