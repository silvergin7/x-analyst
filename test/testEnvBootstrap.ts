import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const envPath = path.join(path.resolve(import.meta.dirname, ".."), ".test-env.json");
if (existsSync(envPath)) {
  const parsed = JSON.parse(readFileSync(envPath, "utf8")) as Record<string, string>;
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value.trim() !== "" && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
