#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCliArgs } from "./cliArgs.js";
import { AnalystListError, analystHandlesFromList, loadAnalystList } from "./config/analystList.js";
import { loadLlmRuntimeConfig, utcReferenceDate } from "./config/llmSettings.js";
import { DEFAULT_QUESTION } from "./config.js";
import { printAnalyzePreflight } from "./analyzePreflight.js";
import { liveTokenizerPreflightMessage } from "./analyze/qwenTokenizerPins.js";
import { validateLiveDesearchRequestLimits } from "./config/desearchSettings.js";
import { serializeRunReportResult } from "./format/runReportJson.js";
import { formatBudgetEstimate } from "./format/llmFixtureReport.js";
import { formatFetchIssue, formatFullReport, formatReportFailure } from "./format/report.js";
import { ReportConfigError, ReportRunError, runReport } from "./runReport.js";
import { confirmProceed } from "./runtime/confirmationGate.js";
import { EnvFileError, loadEnvFileIntoProcess } from "./runtime/loadEnvFile.js";
import { liveFetchEnvLooksDisabled, offlineProviderEnv } from "./runtime/offlineProviderEnv.js";
import { chutesLiveEnvLooksDisabled, stripDesearchForReplayRun } from "./runtime/replayRunEnv.js";
import { validateProviderOverrides } from "./runtime/providerUrlPreflight.js";

const ENV_FILE = ".env";

function defaultReportDirectory(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.X_ANALYST_REPORTS_DIR?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return path.join("data", "reports");
}

function defaultReportPath(referenceDate: string, env: NodeJS.ProcessEnv): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  return path.join(defaultReportDirectory(env), `${referenceDate}-${stamp}.json`);
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2), {
    useFixtureHandleDefaults: false,
    strictHandles: true,
  });

  if (options.flagErrors.length > 0) {
    for (const err of options.flagErrors) {
      process.stderr.write(`Input error: ${err}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (options.invalidHandles.length > 0) {
    for (const item of options.invalidHandles) {
      process.stderr.write(`Input error: Invalid handle "${item.raw}": ${item.reason}\n`);
    }
    process.exitCode = 1;
    return;
  }

  let runEnv: NodeJS.ProcessEnv = { ...process.env };
  if (!options.offline) {
    try {
      loadEnvFileIntoProcess(options.envFilePath ?? ENV_FILE, runEnv);
    } catch (err) {
      const message =
        err instanceof EnvFileError
          ? `${err.message} Copy .env.example to .env for live runs.`
          : "Could not load .env";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
    const replayRun = options.replayPath !== undefined;
    if (replayRun) {
      if (chutesLiveEnvLooksDisabled(runEnv)) {
        process.stderr.write(
          "Replay requires Chutes live settings in .env: ANALYSIS_PROVIDER=chutes, LLM_LIVE_ENABLED=true, and CHUTES_API_KEY.\n",
        );
        process.exitCode = 1;
        return;
      }
    } else if (liveFetchEnvLooksDisabled(runEnv)) {
      process.stderr.write(
        "Live providers are not fully enabled in .env. Use --offline for mock runs or complete the Desearch and Chutes gates.\n",
      );
      process.exitCode = 1;
      return;
    }
  } else {
    runEnv = offlineProviderEnv(runEnv);
  }

  let handles = options.handles;
  if (!options.handlesFlagSeen) {
    try {
      handles = analystHandlesFromList(loadAnalystList(runEnv));
    } catch (err) {
      const message = err instanceof AnalystListError ? err.message : "Could not load analyst list";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  if (handles.length === 0) {
    process.stderr.write("At least one valid handle is required.\n");
    process.exitCode = 1;
    return;
  }

  const referenceDate = options.asOf ?? utcReferenceDate();
  const question = options.questionFlagSeen ? options.question : DEFAULT_QUESTION;
  const llm = loadLlmRuntimeConfig(runEnv);

  if (!options.offline) {
    const urlOverrides = validateProviderOverrides(runEnv, {
      offline: false,
      replay: options.replayPath !== undefined,
    });
    if (!urlOverrides.ok) {
      process.stderr.write(`Preflight error: ${urlOverrides.message}\n`);
      process.exitCode = 1;
      return;
    }
    const tokenizerMessage = liveTokenizerPreflightMessage(runEnv);
    if (tokenizerMessage !== null) {
      process.stderr.write(`${tokenizerMessage}\n`);
      process.exitCode = 1;
      return;
    }
    if (options.replayPath === undefined) {
      const limits = validateLiveDesearchRequestLimits(runEnv);
      if (!limits.ok) {
        for (const err of limits.errors) {
          process.stderr.write(`Preflight error: ${err.message}\n`);
        }
        process.exitCode = 1;
        return;
      }
    }
  }

  printAnalyzePreflight({
    handles,
    question,
    referenceDate,
    model: llm.model,
    replay: options.replayPath !== undefined,
    offline: options.offline,
    env: runEnv,
  });

  const confirmed = await confirmProceed({
    yesFlag: options.yes,
    isTTY: process.stdin.isTTY === true,
  });
  if (!confirmed) {
    process.stderr.write("Stopped before any request.\n");
    process.exitCode = 1;
    return;
  }

  if (options.replayPath !== undefined && !options.offline) {
    runEnv = stripDesearchForReplayRun(runEnv);
  }

  try {
    const result = await runReport(
      handles,
      { text: question },
      {
        referenceDate,
        fresh: options.fresh,
        replayPath: options.replayPath,
        env: runEnv,
        onEstimate: (estimate) => {
          process.stdout.write(`${formatBudgetEstimate(estimate)}\n`);
        },
      },
    );

    const fetchNotes = [
      ...result.fetchOutcomes
        .map((outcome) => formatFetchIssue(outcome, result.postsSource))
        .filter((line) => line.length > 0),
    ];

    const output = formatFullReport(
      question,
      fetchNotes,
      result.reports,
      {
        postsSource: result.postsSource,
        analysisSource: result.analysisSource,
        referenceDate: result.referenceDate,
        fetchedAt: result.fetchedAt,
        fetchedCommit: result.fetchedCommit,
        reused: result.reused,
        replayed: result.replayed,
        billing: result.billing,
      },
      result.handleFailures,
    );
    process.stdout.write(output);

    const reportPath = options.outputPath ?? defaultReportPath(referenceDate, runEnv);
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      serializeRunReportResult(question, result, reportPath),
      "utf8",
    );
    process.stdout.write(`Report JSON: ${reportPath}\n`);

    if (result.handleFailures.length > 0) {
      process.exitCode = 1;
    }
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
