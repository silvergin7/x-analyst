import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listNestedFiles, listTopLevelFiles } from "./support/dataDirListing.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

function useTempDir(name: string, prefix: string): void {
  if (process.env[name]?.trim() === "") delete process.env[name];
  if (!process.env[name]) {
    process.env[name] = mkdtempSync(path.join(tmpdir(), prefix));
  }
}

useTempDir("X_ANALYST_SLICE_DIR", "x-analyst-test-slices-");
useTempDir("X_ANALYST_REPORTS_DIR", "x-analyst-test-reports-");
useTempDir("X_ANALYST_TOKENIZER_CACHE_DIR", "x-analyst-test-tokenizers-");

if (process.env.X_ANALYST_MODEL_STATE_PATH?.trim() === "") {
  delete process.env.X_ANALYST_MODEL_STATE_PATH;
}
if (!process.env.X_ANALYST_MODEL_STATE_PATH) {
  const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-test-model-state-"));
  process.env.X_ANALYST_MODEL_STATE_PATH = path.join(dir, "state.json");
}

const snapshotPath = path.join(repoRoot, ".test-data-dir-snapshot.json");

writeFileSync(
  snapshotPath,
  JSON.stringify(
    {
      slices: listTopLevelFiles(path.join(repoRoot, "data/slices")),
      reports: listTopLevelFiles(path.join(repoRoot, "data/reports")),
      models: listNestedFiles(path.join(repoRoot, "data/models")),
      tokenizers: listNestedFiles(path.join(repoRoot, "data/tokenizers")),
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
      X_ANALYST_MODEL_STATE_PATH: process.env.X_ANALYST_MODEL_STATE_PATH,
      X_ANALYST_TOKENIZER_CACHE_DIR: process.env.X_ANALYST_TOKENIZER_CACHE_DIR,
    },
    null,
    2,
  ),
  "utf8",
);
