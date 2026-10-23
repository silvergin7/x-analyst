import { parseHandleList, validateHandle } from "./handles.js";

export function parseHandleListStrict(input: string): {
  valid: string[];
  invalid: { raw: string; reason: string }[];
} {
  const parts = input
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const valid: string[] = [];
  const invalid: { raw: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const raw of parts) {
    const result = validateHandle(raw);
    if (!result.ok) {
      invalid.push({ raw, reason: result.reason });
      continue;
    }
    if (seen.has(result.normalized)) {
      invalid.push({ raw, reason: "duplicate handle" });
      continue;
    }
    seen.add(result.normalized);
    valid.push(result.normalized);
  }
  return { valid, invalid };
}

export { parseHandleList };
