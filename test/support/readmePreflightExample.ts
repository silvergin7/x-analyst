import { buildAnalyzePreflightLines } from "../../src/analyzePreflight.js";
import { DESEARCH_PLACEHOLDER_KEY } from "../../src/config/desearchSettings.js";
import { LLM_API_KEY_PLACEHOLDER } from "../../src/config/llmSettings.js";
import { DEFAULT_QUESTION } from "../../src/config.js";
import { withTestChutesModelEnv } from "./chutesTestModel.js";
import { testChutesModelPlan } from "./testChutesModelPlan.js";

export const README_PREFLIGHT_REFERENCE_DATE = "2026-10-10";
export const README_PREFLIGHT_HANDLE = "bullmacro";

export function readmePreflightExampleEnv(): NodeJS.ProcessEnv {
  return withTestChutesModelEnv({
    POSTS_PROVIDER: "desearch",
    DESEARCH_API_KEY: DESEARCH_PLACEHOLDER_KEY,
    DESEARCH_LIVE_ENABLED: "true",
    DESEARCH_MAX_REQUESTS_PER_RUN: "5",
    DESEARCH_MAX_REQUESTS_PER_HANDLE: "3",
    ANALYSIS_PROVIDER: "chutes",
    LLM_LIVE_ENABLED: "true",
    CHUTES_API_KEY: LLM_API_KEY_PLACEHOLDER,
  });
}

export function readmePreflightExampleLines(): string[] {
  return buildAnalyzePreflightLines({
    handles: [README_PREFLIGHT_HANDLE],
    question: DEFAULT_QUESTION,
    referenceDate: README_PREFLIGHT_REFERENCE_DATE,
    replay: false,
    offline: false,
    env: readmePreflightExampleEnv(),
    chutesModelPlan: testChutesModelPlan(),
  });
}

export function readmePreflightReadmeLines(fullLines: readonly string[]): string[] {
  return fullLines.filter((line) => !line.startsWith("Warning:"));
}
