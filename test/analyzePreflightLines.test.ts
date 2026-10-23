import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { buildAnalyzePreflightLines } from "../src/analyzePreflight.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";

const baseInput = {
  handles: ["bullmacro"],
  question: "What is the outlook?",
  referenceDate: "2026-10-10",
  model: "Qwen/Qwen3-32B-TEE",
  env: {
    DESEARCH_MAX_REQUESTS_PER_RUN: "5",
    DESEARCH_MAX_REQUESTS_PER_HANDLE: "3",
  } as NodeJS.ProcessEnv,
};

describe("analyze preflight lines", () => {
  beforeEach(() => installByteQuarterMockTokenizer());
  afterEach(() => clearMockTokenizer());

  it("prints the seven-line offline block", () => {
    const lines = buildAnalyzePreflightLines({ ...baseInput, offline: true, replay: false });
    assert.deepEqual(lines, [
      "Handles: bullmacro",
      "Question: What is the outlook?",
      "Analysis reference date: 2026-10-10",
      "DESEARCH_MAX_REQUESTS_PER_RUN: not required offline",
      "DESEARCH_MAX_REQUESTS_PER_HANDLE: not required offline",
      "Desearch: not used (offline)",
      "Chutes: not used (offline)",
    ]);
  });

  it("prints the same offline block for --offline --replay", () => {
    const lines = buildAnalyzePreflightLines({ ...baseInput, offline: true, replay: true });
    assert.deepEqual(lines, [
      "Handles: bullmacro",
      "Question: What is the outlook?",
      "Analysis reference date: 2026-10-10",
      "DESEARCH_MAX_REQUESTS_PER_RUN: not required offline",
      "DESEARCH_MAX_REQUESTS_PER_HANDLE: not required offline",
      "Desearch: not used (offline)",
      "Chutes: not used (offline)",
    ]);
  });

  it("prints replay lines without Desearch host or count", () => {
    const lines = buildAnalyzePreflightLines({ ...baseInput, offline: false, replay: true });
    assert.equal(lines[0], "Chutes host: https://llm.chutes.ai");
    assert.ok(!lines.some((line) => line.startsWith("Desearch host:")));
    assert.ok(!lines.some((line) => line.includes("count query parameter")));
    assert.ok(lines.some((line) => line === "Desearch: not used (replay), $0.000000"));
    assert.ok(
      lines.some((line) =>
        line.startsWith("Chutes worst-case local estimate (not a charge; larger of modest and long post shapes):"),
      ),
    );
    const runIdx = lines.indexOf("DESEARCH_MAX_REQUESTS_PER_RUN: not required for replay");
    assert.ok(runIdx >= 0);
    assert.equal(lines[runIdx + 1], "DESEARCH_MAX_REQUESTS_PER_HANDLE: not required for replay");
  });

  it("mutation: offline must not show (unset) for per-handle limit", () => {
    const lines = buildAnalyzePreflightLines({ ...baseInput, offline: true, replay: false });
    assert.ok(!lines.some((line) => line.includes("(unset)")));
  });

  it("mutation: offline must not print Desearch list-price estimate", () => {
    const lines = buildAnalyzePreflightLines({ ...baseInput, offline: true, replay: false });
    assert.ok(!lines.some((line) => line.includes("list-price estimate")));
  });

  it("mutation: replay must not show numeric Desearch request limits", () => {
    const lines = buildAnalyzePreflightLines({ ...baseInput, offline: false, replay: true });
    assert.ok(!lines.some((line) => /^DESEARCH_MAX_REQUESTS_PER_RUN: \d/.test(line)));
  });
});
