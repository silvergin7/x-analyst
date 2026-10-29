import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildAnalyzePreflightLines } from "../src/analyzePreflight.js";
import { DEFAULT_VENDOR_TOKENIZER_DIR } from "../src/analyze/qwenTokenizerPins.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";
import { testChutesModelPlan } from "./support/testChutesModelPlan.js";
import {
  README_PREFLIGHT_HANDLE,
  README_PREFLIGHT_REFERENCE_DATE,
  readmePreflightExampleEnv,
  readmePreflightExampleLines,
  readmePreflightReadmeLines,
} from "./support/readmePreflightExample.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const readmePath = path.join(repoRoot, "README.md");
const vendorReady =
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer.json`) &&
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer_config.json`);

const CHUTES_ESTIMATE_PREFIX =
  "Chutes worst-case local estimate (not a charge; larger of modest and long post shapes):";

const SKIP_README_DRIFT_PREFIXES = [
  CHUTES_ESTIMATE_PREFIX,
  "Chutes: one request per handle",
  "Chutes model:",
  "Chutes fallbacks:",
  "Chutes model prior valid report:",
  "Chutes catalog:",
  "Chutes per-run worst-case",
];

function readmePreflightBlockLines(): string[] {
  const readme = readFileSync(readmePath, "utf8");
  const marker = "## Run it live";
  const start = readme.indexOf(marker);
  assert.ok(start >= 0);
  const section = readme.slice(start);
  const fenceStart = section.indexOf("```text");
  assert.ok(fenceStart >= 0);
  const bodyStart = fenceStart + "```text".length + 1;
  const fenceEnd = section.indexOf("```", bodyStart);
  assert.ok(fenceEnd > bodyStart);
  return section
    .slice(bodyStart, fenceEnd)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function assertSubsequenceInOrder(haystack: readonly string[], needle: readonly string[]): void {
  let index = 0;
  for (const line of needle) {
    const found = haystack.indexOf(line, index);
    assert.ok(found >= 0, `Missing README line in preflight output: ${line}`);
    index = found + 1;
  }
}

function buildReadmeExampleWithMockTokenizer(): string[] {
  return readmePreflightReadmeLines(
    buildAnalyzePreflightLines({
      handles: [README_PREFLIGHT_HANDLE],
      question: "What is each analyst's current market outlook?",
      referenceDate: README_PREFLIGHT_REFERENCE_DATE,
      replay: false,
      offline: false,
      env: readmePreflightExampleEnv(),
      chutesModelPlan: testChutesModelPlan(),
    }),
  );
}

describe("README live preflight example", () => {
  beforeEach(() => installByteQuarterMockTokenizer());
  afterEach(() => clearMockTokenizer());

  it("lists every non-Chutes README line verbatim and in order without vendor tokenizer", () => {
    const readmeLines = readmePreflightBlockLines();
    const generated = buildReadmeExampleWithMockTokenizer();
    const stableReadmeLines = readmeLines.filter(
      (line) => !SKIP_README_DRIFT_PREFIXES.some((prefix) => line.startsWith(prefix)),
    );
    const stableGenerated = generated.filter(
      (line) => !SKIP_README_DRIFT_PREFIXES.some((prefix) => line.startsWith(prefix)),
    );
    assertSubsequenceInOrder(stableGenerated, stableReadmeLines);
  });

  it("checks the Chutes estimate line against the pinned tokenizer when vendor is present", { skip: !vendorReady }, () => {
    clearMockTokenizer();
    const generatedChutes = readmePreflightReadmeLines(readmePreflightExampleLines()).find((line) =>
      line.startsWith(CHUTES_ESTIMATE_PREFIX),
    );
    assert.ok(generatedChutes !== undefined);
    assert.match(generatedChutes, /summed across handles$/);
  });

  it("skips the Chutes estimate comparison visibly when vendor is absent", { skip: vendorReady }, () => {
    assert.equal(vendorReady, false);
  });
});
