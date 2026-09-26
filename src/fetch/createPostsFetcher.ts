import { cliPostsProvider, loadPostsProviderConfig } from "../config/postsProvider.js";
import { loadDesearchSettings } from "../config/desearchSettings.js";
import type { PostsFetcher } from "./postsFetcher.js";
import { MockPostsFetcher } from "./postsFetcher.js";
import {
  DesearchPostsFetcher,
} from "./desearch/desearchPostsFetcher.js";
import { createHttpDesearchTransport } from "./desearch/httpTransport.js";
import type { DesearchTransport } from "./desearch/desearchTransport.js";

/** Fetcher used by the CLI — always mock regardless of env vars. */
export function createCliPostsFetcher(): PostsFetcher {
  void cliPostsProvider();
  return new MockPostsFetcher();
}

/**
 * Resolve fetcher from env. Live Desearch uses HTTPS only when fully eligible;
 * otherwise returns mock fixtures. Not used by the CLI default path.
 */
export function createPostsFetcherFromEnv(options?: {
  transport?: DesearchTransport;
}): PostsFetcher {
  const { provider } = loadPostsProviderConfig();
  if (provider === "mock") {
    return new MockPostsFetcher();
  }

  const settings = loadDesearchSettings();
  if (!settings.liveEligible) {
    return new MockPostsFetcher();
  }

  const transport = options?.transport ?? createHttpDesearchTransport();
  return new DesearchPostsFetcher({
    transport,
    requireLiveEligible: true,
    settings,
  });
}
