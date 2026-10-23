import { readFileSync } from "node:fs";

export class EnvFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvFileError";
  }
}

function parseEnvLine(line: string): { key: string; value: string } | "skip" {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return "skip";
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return "skip";
  const key = trimmed.slice(0, eq).trim();
  if (key === "") return "skip";
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function assertEnvLineParsable(line: string, lineNumber: number): void {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return;
  const parsed = parseEnvLine(line);
  if (parsed !== "skip") return;
  if (!trimmed.includes("=")) {
    throw new EnvFileError(`Could not parse environment file line ${lineNumber}`);
  }
  const eq = trimmed.indexOf("=");
  if (eq <= 0) {
    throw new EnvFileError(`Could not parse environment file line ${lineNumber}`);
  }
  if (trimmed.slice(0, eq).trim() === "") {
    throw new EnvFileError(`Could not parse environment file line ${lineNumber}`);
  }
}

export function loadEnvFileIntoProcess(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new EnvFileError(`Could not read environment file at ${filePath}`);
  }
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    assertEnvLineParsable(lines[index]!, index + 1);
    const parsed = parseEnvLine(lines[index]!);
    if (parsed === "skip") continue;
    if (env[parsed.key] === undefined) {
      env[parsed.key] = parsed.value;
    }
  }
}
