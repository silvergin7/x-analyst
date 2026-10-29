import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SUBPROCESS_STRIPPED_ENV_KEYS = [
  "DESEARCH_LIVE_ENABLED",
  "LLM_LIVE_ENABLED",
  "CHUTES_API_KEY",
  "DESEARCH_API_KEY",
  "CHUTES_CATALOG_FIXTURE_PATH",
  "HF_MODEL_INFO_FIXTURE_DIR",
  "HF_TOKENIZER_FIXTURE_PATH",
] as const;

function subprocessBaseEnv(): NodeJS.ProcessEnv {
  const base = { ...process.env };
  for (const key of SUBPROCESS_STRIPPED_ENV_KEYS) {
    delete base[key];
  }
  return base;
}

export function spawnAnalyzeWithFixtureDeps(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    "node",
    [
      "--import",
      "tsx",
      "--import",
      path.join(repoRoot, "test/support/registerAnalyzeFixtureDeps.ts"),
      path.join(repoRoot, "src/analyzeCli.ts"),
      ...args,
    ],
    {
      cwd: repoRoot,
      env: {
        ...subprocessBaseEnv(),
        ...env,
      },
      encoding: "utf8",
    },
  );
}
