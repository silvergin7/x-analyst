export type PostsProviderName = "mock" | "desearch";

export interface PostsProviderConfig {
  provider: PostsProviderName;
}

const DEFAULT_PROVIDER: PostsProviderName = "mock";

/** Parse POSTS_PROVIDER; invalid or missing values default to mock. */
export function loadPostsProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): PostsProviderConfig {
  const raw = env.POSTS_PROVIDER?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    return { provider: DEFAULT_PROVIDER };
  }
  if (raw === "mock" || raw === "desearch") {
    return { provider: raw };
  }
  return { provider: DEFAULT_PROVIDER };
}

/** Forced mock for callers that must not read POSTS_PROVIDER. */
export function cliPostsProvider(): PostsProviderName {
  return "mock";
}
