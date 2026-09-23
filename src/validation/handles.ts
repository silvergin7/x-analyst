const HANDLE_PATTERN = /^[a-zA-Z0-9_]{1,15}$/;

export type HandleValidation =
  | { ok: true; normalized: string }
  | { ok: false; reason: string };

/** Normalize and validate an X-style handle (without @). */
export function validateHandle(raw: string): HandleValidation {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, reason: "handle is empty" };
  }
  const normalized = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (normalized === "") {
    return { ok: false, reason: "handle is empty after removing @" };
  }
  if (normalized.length > 15) {
    return { ok: false, reason: "handle exceeds 15 characters" };
  }
  if (!HANDLE_PATTERN.test(normalized)) {
    return {
      ok: false,
      reason: "handle must contain only letters, numbers, and underscore",
    };
  }
  return { ok: true, normalized: normalized.toLowerCase() };
}

/** Parse comma-separated handles; invalid entries are returned separately. */
export function parseHandleList(input: string): {
  valid: string[];
  invalid: { raw: string; reason: string }[];
} {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const valid: string[] = [];
  const invalid: { raw: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const raw of parts) {
    const result = validateHandle(raw);
    if (!result.ok) {
      invalid.push({ raw, reason: result.reason });
      continue;
    }
    if (!seen.has(result.normalized)) {
      seen.add(result.normalized);
      valid.push(result.normalized);
    }
  }
  return { valid, invalid };
}
