#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCliArgs } from "./cliArgs.js";
import { AnalystListError, analystHandlesFromList, loadAnalystList } from "./config/analystList.js";
import {
  loadLlmRuntimeConfig,
  readInputMaxCharsStrict,
  utcReferenceDate,
} from "./config/llmSettings.js";
import { DEFAULT_QUESTION } from "./config.js";
import { assertPrimaryRunBudgetPreflight, printAnalyzePreflight } from "./analyzePreflight.js";
import { desearchWorstCaseListPriceUsd, sampleDesearchRequest } from "./runtime/desearchPreflight.js";
import { loadDesearchMaxRequestsPerHandle, loadDesearchRequestBudget } from "./config/desearchSettings.js";
import { readAnalyzeCliTransportDeps } from "./analyze/analyzeCliDeps.js";
import { createFetchChutesCatalogTransport } from "./analyze/chutesCatalogTransport.js";
import {
  buildChutesModelPlanForRun,
  ChutesPreflightPlanError,
} from "./analyze/buildChutesModelPlanForRun.js";
import { createHuggingFaceModelInfoTransport } from "./analyze/huggingfaceModelInfoTransport.js";
import { forbiddenTestFixtureEnvMessage } from "./analyze/testFixtureEnvGuard.js";
import { applyChutesModelToEnv } from "./config/llmSettings.js";
import type { ChutesModelPlan } from "./analyze/chutesModelSelection.js";
import { validateLiveDesearchRequestLimits } from "./config/desearchSettings.js";
import { serializeRunReportResult } from "./format/runReportJson.js";
import { formatBudgetEstimate } from "./format/llmFixtureReport.js";
import { formatFetchIssue, formatFullReport, formatReportFailure } from "./format/report.js";
import { ReportConfigError, ReportRunError, runReport } from "./runReport.js";
import { confirmProceed } from "./runtime/confirmationGate.js";
import { EnvFileError, loadEnvFileIntoProcess } from "./runtime/loadEnvFile.js";
import { liveFetchEnvLooksDisabled, offlineProviderEnv } from "./runtime/offlineProviderEnv.js";
import { chutesLiveEnvLooksDisabled, stripDesearchForReplayRun } from "./runtime/replayRunEnv.js";
import { fetchOutcomesFailExit } from "./runtime/fetchExitCode.js";
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
  if (options.offline) {
    if (options.envFilePath !== undefined) {
      try {
        loadEnvFileIntoProcess(options.envFilePath, runEnv);
      } catch (err) {
        const message = err instanceof EnvFileError ? err.message : "Could not load env file";
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
        return;
      }
    }
    runEnv = offlineProviderEnv(runEnv);
  } else {
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

  let chutesModelPlan: ChutesModelPlan | undefined;

  if (!options.offline) {
    const fixtureMessage = forbiddenTestFixtureEnvMessage(runEnv);
    if (fixtureMessage !== null) {
      process.stderr.write(`Preflight error: ${fixtureMessage}\n`);
      process.exitCode = 1;
      return;
    }
    const transportDeps = readAnalyzeCliTransportDeps();
    const urlOverrides = validateProviderOverrides(runEnv, {
      offline: false,
      replay: options.replayPath !== undefined,
    });
    if (!urlOverrides.ok) {
      process.stderr.write(`Preflight error: ${urlOverrides.message}\n`);
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
    try {
      chutesModelPlan = await buildChutesModelPlanForRun({
        env: runEnv,
        handles,
        question,
        referenceDate,
        replay: options.replayPath !== undefined,
        catalogTransport: transportDeps.catalogTransport ?? createFetchChutesCatalogTransport(),
        hfTransport: transportDeps.hfTransport ?? createHuggingFaceModelInfoTransport(),
        hfDownloadTransport: transportDeps.hfDownloadTransport,
      });
      applyChutesModelToEnv(runEnv, chutesModelPlan.primary.model);
    } catch (err) {
      const message =
        err instanceof ChutesPreflightPlanError ? err.message : "Chutes preflight failed";
      process.stderr.write(`Preflight error: ${message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  const llm = loadLlmRuntimeConfig(runEnv);

  const inputMaxChars = readInputMaxCharsStrict(runEnv);
  if (!inputMaxChars.ok) {
    process.stderr.write(`Preflight error: ${inputMaxChars.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (chutesModelPlan !== undefined) {
    const replayRun = options.replayPath !== undefined;
    const runBudget = loadDesearchRequestBudget(runEnv);
    const perHandleCap = loadDesearchMaxRequestsPerHandle(runEnv);
    const requestsPerHandle =
      perHandleCap === undefined ? runBudget : Math.min(perHandleCap, runBudget);
    const sample = sampleDesearchRequest();
    const desearch = replayRun
      ? null
      : desearchWorstCaseListPriceUsd({
          handles: handles.length,
          requestsPerHandle,
          sampleRequest: sample,
        });
    const maxRetrievedPostsPerHandle = desearch
      ? desearch.postsPerRequest * requestsPerHandle
      : 55;
    try {
      assertPrimaryRunBudgetPreflight({
        question,
        referenceDate,
        handles,
        maxRetrievedPostsPerHandle,
        env: runEnv,
        chutesModelPlan,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chutes run budget preflight failed";
      process.stderr.write(`Preflight error: ${message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  printAnalyzePreflight({
    handles,
    question,
    referenceDate,
    replay: options.replayPath !== undefined,
    offline: options.offline,
    env: runEnv,
    chutesModelPlan,
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
        chutesModelPlan,
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

    if (result.handleFailures.length > 0 || fetchOutcomesFailExit(result.fetchOutcomes)) {
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
