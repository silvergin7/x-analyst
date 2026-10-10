import { cliPostsProvider, loadPostsProviderConfig } from "../config/postsProvider.js";
import {
  loadDesearchMaxRequestsPerHandle,
  loadDesearchRequestBudget,
  loadDesearchSettings,
  resolveDesearchApiKey,
  type DesearchSettings,
} from "../config/desearchSettings.js";
import type { PostsFetcher } from "./postsFetcher.js";
import { MockPostsFetcher } from "./postsFetcher.js";
import {
  DesearchNotConfiguredError,
  DesearchPostsFetcher,
} from "./desearch/desearchPostsFetcher.js";
import { createHttpDesearchTransport } from "./desearch/httpTransport.js";
import type { DesearchTransport } from "./desearch/desearchTransport.js";

/** Fetcher used by the CLI — always mock regardless of env vars. */
export function createCliPostsFetcher(): PostsFetcher {
  void cliPostsProvider();
  return new MockPostsFetcher();
}

export interface CreatePostsFetcherOptions {
  transport?: DesearchTransport;
  env?: NodeJS.ProcessEnv;
  /**
   * "mock" is the historical fallback when Desearch is selected but incomplete.
   * "throw" is the shared report path: that selection does not become fixture posts.
   */
  ineligibleDesearch?: "mock" | "throw";
}

function createEligibleDesearchFetcher(
  env: NodeJS.ProcessEnv,
  settings: DesearchSettings,
  transport: DesearchTransport | undefined,
): DesearchPostsFetcher {
  return new DesearchPostsFetcher({
    transport: transport ?? createHttpDesearchTransport(),
    requireLiveEligible: true,
    settings,
    credential: resolveDesearchApiKey(env),
    maxRequestsPerRun: loadDesearchRequestBudget(env),
    maxRequestsPerHandle: loadDesearchMaxRequestsPerHandle(env),
  });
}

/**
 * Resolve a fetcher from env and an optional transport.
 * The default incomplete-Desearch behavior returns mock fixtures.
 * Pass ineligibleDesearch "throw" when an explicit Desearch selection must fail closed.
 */
export function createPostsFetcherFromEnv(
  options?: CreatePostsFetcherOptions,
): PostsFetcher {
  const env = options?.env ?? process.env;
  const { provider } = loadPostsProviderConfig(env);
  if (provider === "mock") {
    return new MockPostsFetcher();
  }

  const settings = loadDesearchSettings(env);
  if (!settings.liveEligible) {
    if (options?.ineligibleDesearch === "throw") {
      throw new DesearchNotConfiguredError(
        "Desearch was selected but is not fully enabled. Set POSTS_PROVIDER=desearch, DESEARCH_LIVE_ENABLED=true, and a real DESEARCH_API_KEY.",
      );
    }
    return new MockPostsFetcher();
  }

  return createEligibleDesearchFetcher(env, settings, options?.transport);
}
