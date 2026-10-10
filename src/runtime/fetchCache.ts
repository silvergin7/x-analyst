import type { FetchOutcome } from "../types.js";

export interface StoredFetchSlice {
  outcomes: FetchOutcome[];
  fetchedAt: string;
}

/**
 * In-memory slice cache for one process.
 * It keeps only the latest key and slice. Storing a different key replaces that entry.
 * It does not persist and does not cache analysis.
 */
export interface FetchSliceCache {
  read(key: string): StoredFetchSlice | undefined;
  store(key: string, outcomes: FetchOutcome[]): StoredFetchSlice;
}

export function fetchCacheKey(input: {
  postsSource: string;
  handles: readonly string[];
  maxPostsPerPerson: number;
  maxPostsTotal: number;
  maxRequestsPerRun: number;
}): string {
  return JSON.stringify({
    postsSource: input.postsSource,
    handles: [...input.handles],
    maxPostsPerPerson: input.maxPostsPerPerson,
    maxPostsTotal: input.maxPostsTotal,
    maxRequestsPerRun: input.maxRequestsPerRun,
  });
}

export function createFetchSliceCache(
  now: () => Date = () => new Date(),
): FetchSliceCache {
  let entry: { key: string; slice: StoredFetchSlice } | undefined;
  return {
    read(key) {
      if (!entry || entry.key !== key) return undefined;
      return {
        outcomes: structuredClone(entry.slice.outcomes),
        fetchedAt: entry.slice.fetchedAt,
      };
    },
    store(key, outcomes) {
      const stored = {
        outcomes: structuredClone(outcomes),
        fetchedAt: now().toISOString(),
      };
      entry = { key, slice: stored };
      return {
        outcomes: structuredClone(stored.outcomes),
        fetchedAt: stored.fetchedAt,
      };
    },
  };
}

/** Process-lifetime cache used by the API and CLI. Tests can pass a private cache. */
export const sharedFetchSliceCache = createFetchSliceCache();
