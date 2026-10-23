export function offlineProviderEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    POSTS_PROVIDER: "mock",
    ANALYSIS_PROVIDER: "mock",
    LLM_LIVE_ENABLED: "false",
    DESEARCH_LIVE_ENABLED: "false",
    CHUTES_API_KEY: "",
    DESEARCH_API_KEY: "",
  };
}

export function liveProviderEnvLooksDisabled(env: NodeJS.ProcessEnv): boolean {
  const posts = env.POSTS_PROVIDER?.trim().toLowerCase();
  const analysis = env.ANALYSIS_PROVIDER?.trim().toLowerCase();
  const desearchOff = env.DESEARCH_LIVE_ENABLED !== "true";
  const llmOff = env.LLM_LIVE_ENABLED !== "true";
  return (
    posts !== "desearch" ||
    analysis !== "chutes" ||
    desearchOff ||
    llmOff ||
    (env.DESEARCH_API_KEY?.trim() ?? "") === "" ||
    (env.CHUTES_API_KEY?.trim() ?? "") === ""
  );
}
