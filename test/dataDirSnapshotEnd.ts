import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { listNestedFiles, listTopLevelFiles } from "./support/dataDirListing.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const snapshotPath = path.join(repoRoot, ".test-data-dir-snapshot.json");

const before = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
  slices: Record<string, number>;
  reports: Record<string, number>;
  models: Record<string, number>;
  tokenizers: Record<string, number>;
};

assert.deepEqual(
  listTopLevelFiles(path.join(repoRoot, "data/slices")),
  before.slices,
  "data/slices changed during npm test; use X_ANALYST_SLICE_DIR in tests",
);
assert.deepEqual(
  listTopLevelFiles(path.join(repoRoot, "data/reports")),
  before.reports,
  "data/reports changed during npm test; use X_ANALYST_REPORTS_DIR in tests",
);
assert.deepEqual(
  listNestedFiles(path.join(repoRoot, "data/models")),
  before.models,
  "data/models changed during npm test; use X_ANALYST_MODEL_STATE_PATH in tests",
);
assert.deepEqual(
  listNestedFiles(path.join(repoRoot, "data/tokenizers")),
  before.tokenizers,
  "data/tokenizers changed during npm test; use X_ANALYST_TOKENIZER_CACHE_DIR in tests",
);
