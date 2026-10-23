import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..");

export const REPORTS_DIRECTORY = path.join(repoRoot, "data", "reports");

const BASENAME_PATTERN = /^[-A-Za-z0-9_.]+\.json$/;

export class ReportPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportPathError";
  }
}

export function isSafeReportBasename(id: string): boolean {
  if (id.includes("..") || id.includes("/") || id.includes("\\")) return false;
  return BASENAME_PATTERN.test(id);
}

export function resolveReportFile(basename: string): string {
  if (!isSafeReportBasename(basename)) {
    throw new ReportPathError("Report id must be a plain .json basename");
  }
  const resolved = path.join(REPORTS_DIRECTORY, basename);
  const normalizedDir = path.resolve(REPORTS_DIRECTORY) + path.sep;
  if (!path.resolve(resolved).startsWith(normalizedDir)) {
    throw new ReportPathError("Report path escapes the reports directory");
  }
  return resolved;
}

export function listReportBasenames(): string[] {
  try {
    return readdirSync(REPORTS_DIRECTORY)
      .filter((name) => isSafeReportBasename(name))
      .sort();
  } catch {
    return [];
  }
}

export function readReportJson(basename: string): unknown {
  const filePath = resolveReportFile(basename);
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}
