/** Placeholder values in .env.example — never treat as real credentials. */
export const DESEARCH_PLACEHOLDER_KEY = "replace_me_only_when_you_are_ready";

const DEFAULT_MAX_REQUESTS_PER_RUN = 5;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return fallback;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1 || !Number.isSafeInteger(n)) return fallback;
  return n;
}

/**
 * Caps HTTP calls to Desearch per fetch run (separate from post retention caps).
 * Not a dollar spending limit — each request may return an undocumented number of billable posts.
 */
export function loadDesearchRequestBudget(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePositiveInt(
    env.DESEARCH_MAX_REQUESTS_PER_RUN,
    DEFAULT_MAX_REQUESTS_PER_RUN,
  );
}

/**
 * Optional cap on Desearch HTTP requests for one handle.
 * Unset, empty, or malformed means no per-handle limit.
 */
export function loadDesearchMaxRequestsPerHandle(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.DESEARCH_MAX_REQUESTS_PER_HANDLE;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return undefined;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(n) || n < 1) return undefined;
  return n;
}

/** A positive override is a per-handle cap. Anything else means no per-handle limit. */
export function resolveMaxRequestsPerHandleOverride(override?: number): number | undefined {
  if (override === undefined) return undefined;
  if (!Number.isSafeInteger(override) || override < 1) return undefined;
  return override;
}

/** Validate constructor override for max HTTP requests per run. */
export function resolveMaxRequestsPerRunOverride(override?: number): number {
  if (override === undefined) {
    return loadDesearchRequestBudget();
  }
  if (!Number.isFinite(override) || !Number.isSafeInteger(override) || override < 1) {
    return loadDesearchRequestBudget();
  }
  return override;
}

/** Non-secret Desearch configuration for eligibility checks and reporting. */
export interface DesearchSettings {
  /** True only when provider is desearch, live flag set, and a usable key is present. */
  liveEligible: boolean;
  /** True when env contains a non-placeholder key (the key itself is never returned here). */
  hasUsableCredential: boolean;
}

function isUsableKey(key: string | undefined): key is string {
  if (key === undefined) return false;
  const trimmed = key.trim();
  if (trimmed === "") return false;
  if (trimmed === DESEARCH_PLACEHOLDER_KEY) return false;
  return true;
}

/**
 * Load Desearch-related env without logging or exposing secrets.
 * Live mode stays off unless explicitly configured (see .env.example).
 */
export function loadDesearchSettings(
  env: NodeJS.ProcessEnv = process.env,
): DesearchSettings {
  const rawKey = env.DESEARCH_API_KEY?.trim() || undefined;
  const liveFlag = env.DESEARCH_LIVE_ENABLED?.trim().toLowerCase() === "true";
  const provider = env.POSTS_PROVIDER?.trim().toLowerCase();
  const hasUsableCredential = isUsableKey(rawKey);
  const liveEligible =
    provider === "desearch" && liveFlag && hasUsableCredential;
  return { liveEligible, hasUsableCredential };
}

/**
 * Resolve API key for request signing at the transport boundary only.
 * Never log, print, or include in errors, audits, or settings reports.
 */
export function resolveDesearchApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const rawKey = env.DESEARCH_API_KEY?.trim() || undefined;
  return isUsableKey(rawKey) ? rawKey : undefined;
}
