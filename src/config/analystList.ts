import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHandleListStrict } from "../validation/handlesStrict.js";

export interface AnalystEntry {
  handle: string;
  notes?: string;
}

export class AnalystListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalystListError";
  }
}

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

export const DEFAULT_ANALYST_LIST_PATH = path.join(repoRoot, "config", "analysts.json");

function resolveAnalystListPath(env: NodeJS.ProcessEnv): string {
  const raw = env.ANALYST_LIST_PATH?.trim();
  if (raw === undefined || raw === "") return DEFAULT_ANALYST_LIST_PATH;
  return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEntry(value: unknown, index: number): AnalystEntry {
  if (!isRecord(value)) {
    throw new AnalystListError(`analysts[${index}] must be an object`);
  }
  const keys = Object.keys(value);
  for (const key of keys) {
    if (key !== "handle" && key !== "notes") {
      throw new AnalystListError(`analysts[${index}] has unknown field "${key}"`);
    }
  }
  if (typeof value.handle !== "string") {
    throw new AnalystListError(`analysts[${index}].handle must be a string`);
  }
  if (value.notes !== undefined && typeof value.notes !== "string") {
    throw new AnalystListError(`analysts[${index}].notes must be a string when present`);
  }
  const parsed = parseHandleListStrict(value.handle);
  if (parsed.invalid.length > 0) {
    throw new AnalystListError(
      `analysts[${index}].handle is invalid: ${parsed.invalid[0]!.reason}`,
    );
  }
  if (parsed.valid.length !== 1) {
    throw new AnalystListError(`analysts[${index}].handle must be a single handle`);
  }
  const entry: AnalystEntry = { handle: parsed.valid[0]! };
  if (typeof value.notes === "string" && value.notes.trim() !== "") {
    entry.notes = value.notes;
  }
  return entry;
}

export function parseAnalystListJson(text: string): AnalystEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AnalystListError("Analyst list file must be valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new AnalystListError("Analyst list root must be an object");
  }
  const rootKeys = Object.keys(parsed);
  for (const key of rootKeys) {
    if (key !== "analysts") {
      throw new AnalystListError(`Analyst list root has unknown field "${key}"`);
    }
  }
  if (!Array.isArray(parsed.analysts)) {
    throw new AnalystListError('Analyst list root must include an "analysts" array');
  }
  if (parsed.analysts.length === 0) {
    throw new AnalystListError("Analyst list must include at least one analyst");
  }
  const entries = parsed.analysts.map((item, index) => parseEntry(item, index));
  const handles = entries.map((entry) => entry.handle);
  const seen = new Set<string>();
  for (const handle of handles) {
    if (seen.has(handle)) {
      throw new AnalystListError(`Duplicate handle in analyst list: ${handle}`);
    }
    seen.add(handle);
  }
  return entries;
}

export function loadAnalystList(env: NodeJS.ProcessEnv = process.env): AnalystEntry[] {
  const listPath = resolveAnalystListPath(env);
  let text: string;
  try {
    text = readFileSync(listPath, "utf8");
  } catch {
    throw new AnalystListError(`Could not read analyst list at ${listPath}`);
  }
  return parseAnalystListJson(text);
}

export function analystHandlesFromList(entries: readonly AnalystEntry[]): string[] {
  return entries.map((entry) => entry.handle);
}
