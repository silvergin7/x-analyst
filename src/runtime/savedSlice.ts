import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  FetchIncompleteReason,
  FetchOutcome,
  FetchStopReason,
  Post,
  PostKind,
  PostSource,
} from "../types.js";

export const SAVED_SLICE_VERSION = 1;
export const DEFAULT_SLICE_DIRECTORY = path.join("data", "slices");

export function resolveSliceDirectory(
  env: NodeJS.ProcessEnv,
  override?: string,
): string {
  if (override !== undefined && override.trim() !== "") return override;
  const fromEnv = env.X_ANALYST_SLICE_DIR?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return DEFAULT_SLICE_DIRECTORY;
}

const POST_KINDS = new Set<PostKind>(["original", "repost", "quote"]);
const INCOMPLETE_REASONS = new Set<FetchIncompleteReason>([
  "total_post_limit_reached",
  "per_person_limit_reached",
  "desearch_request_budget_exhausted",
  "desearch_handle_request_limit_reached",
  "desearch_page_no_valid_posts",
  "desearch_retrieval_interrupted",
]);
const STOP_REASONS = new Set<FetchStopReason>([
  "lookback_window_reached",
  "no_more_pages",
  "desearch_request_budget_exhausted",
  "desearch_handle_request_limit_reached",
]);
const SECRET_KEYS = new Set([
  "authorization",
  "headers",
  "apikey",
  "api_key",
  "cookie",
  "set-cookie",
]);

export interface SavedSliceFile {
  version: typeof SAVED_SLICE_VERSION;
  fetchedAt: string;
  fetchedCommit: string;
  referenceDate: string;
  handles: string[];
  postsSource: PostSource;
  outcomes: FetchOutcome[];
}

export class SavedSliceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedSliceError";
  }
}

/** Current commit, or "unavailable" when git cannot answer. */
export function readRepositoryCommit(cwd = process.cwd()): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Drop billing and reject keys that could carry request secrets. */
export function outcomesForSlice(outcomes: readonly FetchOutcome[]): FetchOutcome[] {
  const cloned = structuredClone(outcomes).map((outcome) => {
    const copy = { ...outcome };
    delete copy.billing;
    return copy;
  });
  assertNoSecretKeys(cloned);
  return cloned;
}

/** Write one slice file. Returns the file path. */
function assertNotDefaultSliceDirInTests(directory: string): void {
  const testOverride = process.env.X_ANALYST_SLICE_DIR?.trim();
  if (testOverride === undefined || testOverride === "") return;
  if (path.resolve(directory) === path.resolve(DEFAULT_SLICE_DIRECTORY)) {
    throw new SavedSliceError(
      "Refusing to write to data/slices while X_ANALYST_SLICE_DIR is set (test isolation)",
    );
  }
}

export function saveSlice(directory: string, slice: SavedSliceFile): string {
  assertNotDefaultSliceDirInTests(directory);
  if (slice.version !== SAVED_SLICE_VERSION) {
    throw new SavedSliceError("Saved slice version is not supported");
  }
  assertNoSecretKeys(slice);
  mkdirSync(directory, { recursive: true });
  const stamp = slice.fetchedAt.replace(/[:.]/g, "");
  const stem = `${stamp}-${slice.fetchedCommit.slice(0, 12)}`;
  let filePath = path.join(directory, `${stem}.json`);
  let suffix = 2;
  while (existsSync(filePath)) {
    filePath = path.join(directory, `${stem}-${suffix}.json`);
    suffix += 1;
  }
  writeFileSync(filePath, `${JSON.stringify(slice, null, 2)}\n`, "utf8");
  return filePath;
}

/** Read a slice file. Does not contact a provider. */
export function loadSlice(filePath: string): SavedSliceFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new SavedSliceError(`Could not read slice file ${filePath}`);
  }
  if (!isRecord(parsed)) throw new SavedSliceError("Slice file is not an object");
  assertNoSecretKeys(parsed);
  if (parsed.version !== SAVED_SLICE_VERSION) {
    throw new SavedSliceError("Slice file version is not supported");
  }
  if (typeof parsed.fetchedAt !== "string" || parsed.fetchedAt.trim() === "") {
    throw new SavedSliceError("Slice file is missing fetchedAt");
  }
  if (typeof parsed.fetchedCommit !== "string" || parsed.fetchedCommit.trim() === "") {
    throw new SavedSliceError("Slice file is missing fetchedCommit");
  }
  if (typeof parsed.referenceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.referenceDate)) {
    throw new SavedSliceError("Slice file referenceDate must be YYYY-MM-DD");
  }
  if (
    !Array.isArray(parsed.handles) ||
    parsed.handles.some((handle) => typeof handle !== "string")
  ) {
    throw new SavedSliceError("Slice file handles must be a string array");
  }
  const handles = parsed.handles as string[];
  if (parsed.postsSource !== "fixtures" && parsed.postsSource !== "desearch") {
    throw new SavedSliceError("Slice file postsSource is not supported");
  }
  if (!Array.isArray(parsed.outcomes)) {
    throw new SavedSliceError("Slice file outcomes must be an array");
  }
  const outcomes = parsed.outcomes.map((outcome, index) => readOutcome(outcome, index));
  return {
    version: SAVED_SLICE_VERSION,
    fetchedAt: parsed.fetchedAt,
    fetchedCommit: parsed.fetchedCommit,
    referenceDate: parsed.referenceDate,
    handles,
    postsSource: parsed.postsSource,
    outcomes,
  };
}

function readOutcome(value: unknown, index: number): FetchOutcome {
  if (!isRecord(value)) throw new SavedSliceError(`Slice outcome ${index} is not an object`);
  if ("billing" in value) throw new SavedSliceError("Slice outcomes must not include billing");
  if (typeof value.handle !== "string" || value.handle.trim() === "") {
    throw new SavedSliceError(`Slice outcome ${index} is missing a handle`);
  }
  if (value.status === "ok") {
    if (!Array.isArray(value.posts)) {
      throw new SavedSliceError(`Slice outcome ${index} posts must be an array`);
    }
    const outcome: FetchOutcome = {
      status: "ok",
      handle: value.handle,
      posts: value.posts.map((post, postIndex) => readPost(post, index, postIndex)),
      retrievalComplete: value.retrievalComplete === true,
    };
    if (typeof value.incompleteReason === "string") {
      if (!INCOMPLETE_REASONS.has(value.incompleteReason as FetchIncompleteReason)) {
        throw new SavedSliceError(`Slice outcome ${index} has a bad incompleteReason`);
      }
      outcome.incompleteReason = value.incompleteReason as FetchIncompleteReason;
    }
    if (typeof value.fetchStopReason === "string") {
      if (!STOP_REASONS.has(value.fetchStopReason as FetchStopReason)) {
        throw new SavedSliceError(`Slice outcome ${index} has a bad fetchStopReason`);
      }
      outcome.fetchStopReason = value.fetchStopReason as FetchStopReason;
    }
    if (typeof value.duplicatePostsRemoved === "number") {
      outcome.duplicatePostsRemoved = value.duplicatePostsRemoved;
    }
    if (isSkipCounts(value.invalidPostsSkipped)) {
      outcome.invalidPostsSkipped = value.invalidPostsSkipped;
    }
    return outcome;
  }
  if (
    value.status === "incomplete" ||
    value.status === "unknown_handle" ||
    value.status === "invalid_handle" ||
    value.status === "empty"
  ) {
    return value as FetchOutcome;
  }
  throw new SavedSliceError(`Slice outcome ${index} has an unknown status`);
}

function readPost(value: unknown, outcomeIndex: number, postIndex: number): Post {
  if (!isRecord(value)) {
    throw new SavedSliceError(`Slice outcome ${outcomeIndex} post ${postIndex} is not an object`);
  }
  if (typeof value.id !== "string" || typeof value.authorHandle !== "string") {
    throw new SavedSliceError(`Slice outcome ${outcomeIndex} post ${postIndex} is missing an id`);
  }
  if (typeof value.text !== "string" || typeof value.timestamp !== "string" || typeof value.url !== "string") {
    throw new SavedSliceError(`Slice outcome ${outcomeIndex} post ${postIndex} is missing text`);
  }
  if (typeof value.kind !== "string" || !POST_KINDS.has(value.kind as PostKind)) {
    throw new SavedSliceError(`Slice outcome ${outcomeIndex} post ${postIndex} has a bad kind`);
  }
  return value as unknown as Post;
}

function assertNoSecretKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretKeys(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      throw new SavedSliceError("Slice data includes a request field that must not be stored");
    }
    assertNoSecretKeys(value[key]);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSkipCounts(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (count) => typeof count === "number" && Number.isInteger(count) && count >= 0,
  );
}
