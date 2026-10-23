export function chutesLiveEnvLooksDisabled(env: NodeJS.ProcessEnv): boolean {
  const analysis = env.ANALYSIS_PROVIDER?.trim().toLowerCase();
  const llmOff = env.LLM_LIVE_ENABLED !== "true";
  return (
    analysis !== "chutes" ||
    llmOff ||
    (env.CHUTES_API_KEY?.trim() ?? "") === ""
  );
}

export function stripDesearchForReplayRun(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    DESEARCH_API_KEY: "",
    DESEARCH_LIVE_ENABLED: "false",
  };
}
