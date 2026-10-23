import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ReportPathError,
  isSafeReportBasename,
  resolveReportFile,
} from "../server/reportsStorage.js";

describe("reports storage", () => {
  it("accepts plain json basenames and rejects traversal", () => {
    assert.equal(isSafeReportBasename("run-2026.json"), true);
    assert.throws(() => resolveReportFile("../secrets.json"), ReportPathError);
    assert.throws(() => resolveReportFile("bad/name.json"), ReportPathError);
  });
});
