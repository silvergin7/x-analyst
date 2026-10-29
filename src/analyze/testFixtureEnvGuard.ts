const FORBIDDEN_FIXTURE_ENV_KEYS = [
  "CHUTES_CATALOG_FIXTURE_PATH",
  "HF_MODEL_INFO_FIXTURE_DIR",
  "HF_TOKENIZER_FIXTURE_PATH",
] as const;

export function forbiddenTestFixtureEnvMessage(env: NodeJS.ProcessEnv): string | null {
  for (const key of FORBIDDEN_FIXTURE_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value !== undefined && value !== "") {
      return `${key} must not be set for live or replay analyze runs`;
    }
  }
  return null;
}
