import { DEFAULT_DESEARCH_API_BASE } from "../fetch/desearch/buildRequest.js";

/** Placeholder values in .env.example — never treat as real credentials. */
export const DESEARCH_PLACEHOLDER_KEY = "replace_me_only_when_you_are_ready";

const DEFAULT_MAX_REQUESTS_PER_RUN = 5;

/** Published Desearch list price, USD per 1,000 posts. Not a provider-reported charge. */
export const DESEARCH_USD_PER_THOUSAND_POSTS = 0.15;

/** List price for a usage count. Separate from cost_usd returned by Desearch. */
export function desearchListPriceUsd(usageCount: number): number {
  return (usageCount / 1000) * DESEARCH_USD_PER_THOUSAND_POSTS;
}

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
export function loadDesearchApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DESEARCH_API_BASE?.trim();
  if (raw === undefined || raw === "") return DEFAULT_DESEARCH_API_BASE;
  return raw.replace(/\/+$/, "");
}

export function loadDesearchRequestBudget(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePositiveInt(
    env.DESEARCH_MAX_REQUESTS_PER_RUN,
    DEFAULT_MAX_REQUESTS_PER_RUN,
  );
}

/**
 * Caps Desearch HTTP requests for one handle when set in env.
 * `loadDesearchMaxRequestsPerHandle` treats unset, empty, or malformed as no cap for fetch runs.
 * Live `npm run analyze` requires a positive integer via `readDesearchMaxRequestsPerHandleStrict`.
 */
export type DesearchLimitField =
  | "DESEARCH_MAX_REQUESTS_PER_RUN"
  | "DESEARCH_MAX_REQUESTS_PER_HANDLE";

export function readDesearchMaxRequestsPerRunStrict(
  env: NodeJS.ProcessEnv,
): { ok: true; value: number } | { ok: false; field: DesearchLimitField; message: string } {
  const raw = env.DESEARCH_MAX_REQUESTS_PER_RUN;
  if (raw === undefined) {
    return {
      ok: false,
      field: "DESEARCH_MAX_REQUESTS_PER_RUN",
      message: "DESEARCH_MAX_REQUESTS_PER_RUN is unset",
    };
  }
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      field: "DESEARCH_MAX_REQUESTS_PER_RUN",
      message: "DESEARCH_MAX_REQUESTS_PER_RUN is malformed",
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(n) || n < 1) {
    return {
      ok: false,
      field: "DESEARCH_MAX_REQUESTS_PER_RUN",
      message: "DESEARCH_MAX_REQUESTS_PER_RUN is malformed",
    };
  }
  return { ok: true, value: n };
}

export function readDesearchMaxRequestsPerHandleStrict(
  env: NodeJS.ProcessEnv,
):
  | { ok: true; value: number }
  | { ok: false; field: DesearchLimitField; message: string } {
  const raw = env.DESEARCH_MAX_REQUESTS_PER_HANDLE;
  if (raw === undefined) {
    return {
      ok: false,
      field: "DESEARCH_MAX_REQUESTS_PER_HANDLE",
      message: "DESEARCH_MAX_REQUESTS_PER_HANDLE is unset",
    };
  }
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      field: "DESEARCH_MAX_REQUESTS_PER_HANDLE",
      message: "DESEARCH_MAX_REQUESTS_PER_HANDLE is malformed",
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(n) || n < 1) {
    return {
      ok: false,
      field: "DESEARCH_MAX_REQUESTS_PER_HANDLE",
      message: "DESEARCH_MAX_REQUESTS_PER_HANDLE is malformed",
    };
  }
  return { ok: true, value: n };
}

export function validateLiveDesearchRequestLimits(
  env: NodeJS.ProcessEnv,
): { ok: true } | { ok: false; errors: { field: DesearchLimitField; message: string }[] } {
  const errors: { field: DesearchLimitField; message: string }[] = [];
  const run = readDesearchMaxRequestsPerRunStrict(env);
  if (!run.ok) errors.push({ field: run.field, message: run.message });
  const perHandle = readDesearchMaxRequestsPerHandleStrict(env);
  if (!perHandle.ok) errors.push({ field: perHandle.field, message: perHandle.message });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

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
