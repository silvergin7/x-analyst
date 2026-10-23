import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const snapshotPath = path.join(repoRoot, ".test-data-dir-snapshot.json");

function listDir(relative: string): Record<string, number> {
  const dir = path.join(repoRoot, relative);
  mkdirSync(dir, { recursive: true });
  const out: Record<string, number> = {};
  for (const name of readdirSync(dir)) {
    const filePath = path.join(dir, name);
    const stat = statSync(filePath);
    if (!stat.isFile()) continue;
    out[name] = stat.size;
  }
  return out;
}

const before = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
  slices: Record<string, number>;
  reports: Record<string, number>;
};
const afterSlices = listDir("data/slices");
const afterReports = listDir("data/reports");

assert.deepEqual(
  afterSlices,
  before.slices,
  "data/slices changed during npm test; use X_ANALYST_SLICE_DIR in tests",
);
assert.deepEqual(
  afterReports,
  before.reports,
  "data/reports changed during npm test; use X_ANALYST_REPORTS_DIR in tests",
);
