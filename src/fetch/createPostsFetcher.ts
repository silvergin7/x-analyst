import { cliPostsProvider, loadPostsProviderConfig } from "../config/postsProvider.js";
import { loadDesearchSettings } from "../config/desearchSettings.js";
import type { PostsFetcher } from "./postsFetcher.js";
import { MockPostsFetcher } from "./postsFetcher.js";
import {
  DesearchNotConfiguredError,
  DesearchPostsFetcher,
  type DesearchPostsFetcherOptions,
} from "./desearch/desearchPostsFetcher.js";
import type { DesearchTransport } from "./desearch/desearchTransport.js";

/** Fetcher used by the CLI — always mock regardless of env vars. */
export function createCliPostsFetcher(): PostsFetcher {
  void cliPostsProvider();
  return new MockPostsFetcher();
}

/**
 * Resolve fetcher from env for future wiring. Fails closed for desearch without full live config.
 * Not called by the CLI in this prototype phase.
 */
export function createPostsFetcherFromEnv(options?: {
  transport?: DesearchTransport;
}): PostsFetcher {
  const { provider } = loadPostsProviderConfig();
  if (provider === "mock") {
    return new MockPostsFetcher();
  }

  if (!options?.transport) {
    throw new DesearchNotConfiguredError(
      "Desearch provider selected but no transport was injected. Live HTTP is not wired in this prototype.",
    );
  }

  const desearchOptions: DesearchPostsFetcherOptions = {
    transport: options.transport,
    requireLiveEligible: true,
    settings: loadDesearchSettings(),
  };
  return new DesearchPostsFetcher(desearchOptions);
}
