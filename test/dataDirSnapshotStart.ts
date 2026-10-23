import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

if (process.env.X_ANALYST_SLICE_DIR?.trim() === "") {
  delete process.env.X_ANALYST_SLICE_DIR;
}
if (process.env.X_ANALYST_REPORTS_DIR?.trim() === "") {
  delete process.env.X_ANALYST_REPORTS_DIR;
}
if (!process.env.X_ANALYST_SLICE_DIR) {
  process.env.X_ANALYST_SLICE_DIR = mkdtempSync(path.join(tmpdir(), "x-analyst-test-slices-"));
}
if (!process.env.X_ANALYST_REPORTS_DIR) {
  process.env.X_ANALYST_REPORTS_DIR = mkdtempSync(path.join(tmpdir(), "x-analyst-test-reports-"));
}
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

writeFileSync(
  snapshotPath,
  JSON.stringify(
    {
      slices: listDir("data/slices"),
      reports: listDir("data/reports"),
    },
    null,
    2,
  ),
  "utf8",
);

writeFileSync(
  path.join(repoRoot, ".test-env.json"),
  JSON.stringify(
    {
      X_ANALYST_SLICE_DIR: process.env.X_ANALYST_SLICE_DIR,
      X_ANALYST_REPORTS_DIR: process.env.X_ANALYST_REPORTS_DIR,
    },
    null,
    2,
  ),
  "utf8",
);
