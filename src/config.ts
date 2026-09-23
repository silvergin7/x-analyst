import type { FetchLimits } from "./types.js";

const DEFAULT_MAX_POSTS_PER_PERSON = 10;
const DEFAULT_MAX_POSTS_TOTAL = 25;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/** Load fetch limits from env with conservative defaults. */
export function loadFetchLimits(): FetchLimits {
  return {
    maxPostsPerPerson: parsePositiveInt(
      process.env.MAX_POSTS_PER_PERSON,
      DEFAULT_MAX_POSTS_PER_PERSON,
    ),
    maxPostsTotal: parsePositiveInt(
      process.env.MAX_POSTS_TOTAL,
      DEFAULT_MAX_POSTS_TOTAL,
    ),
  };
}

export const DEFAULT_HANDLES = ["bullmacro", "bearmacro", "unclearmacro"] as const;

export const DEFAULT_QUESTION =
  "What is each analyst's current market outlook?";
