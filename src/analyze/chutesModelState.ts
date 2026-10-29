import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ChutesModelStateFile {
  lastValidModel: string;
  validModels: string[];
}

const DEFAULT_STATE_PATH = path.join("data", "models", "state.json");

export function chutesModelStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.X_ANALYST_MODEL_STATE_PATH?.trim();
  return override === "" || override === undefined ? DEFAULT_STATE_PATH : override;
}

export function readChutesModelState(
  env: NodeJS.ProcessEnv = process.env,
): ChutesModelStateFile | null {
  const filePath = chutesModelStatePath(env);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write(
      `Warning: ${filePath} is malformed; ignoring sticky model state.\n`,
    );
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    process.stderr.write(
      `Warning: ${filePath} is malformed; ignoring sticky model state.\n`,
    );
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const lastValidModel =
    typeof record.lastValidModel === "string" ? record.lastValidModel.trim() : "";
  const validModelsRaw = record.validModels;
  if (lastValidModel === "" || !Array.isArray(validModelsRaw)) {
    process.stderr.write(
      `Warning: ${filePath} is malformed; ignoring sticky model state.\n`,
    );
    return null;
  }
  const validModels: string[] = [];
  for (const item of validModelsRaw) {
    if (typeof item !== "string" || item.trim() === "") {
      process.stderr.write(
        `Warning: ${filePath} is malformed; ignoring sticky model state.\n`,
      );
      return null;
    }
    validModels.push(item.trim());
  }
  return { lastValidModel, validModels };
}

export function writeChutesModelState(
  state: ChutesModelStateFile,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const filePath = chutesModelStatePath(env);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function recordValidChutesModel(modelId: string, env: NodeJS.ProcessEnv = process.env): void {
  const existing = readChutesModelState(env);
  const validModels = existing?.validModels ?? [];
  const nextValid = validModels.includes(modelId) ? validModels : [...validModels, modelId];
  writeChutesModelState({ lastValidModel: modelId, validModels: nextValid }, env);
}
