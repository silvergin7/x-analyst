/** Placeholder values in .env.example — never treat as real credentials. */
export const DESEARCH_PLACEHOLDER_KEY = "replace_me_only_when_you_are_ready";

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
