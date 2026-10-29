import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export function listTopLevelFiles(dir: string): Record<string, number> {
  mkdirSync(dir, { recursive: true });
  const out: Record<string, number> = {};
  for (const name of readdirSync(dir)) {
    const filePath = path.join(dir, name);
    const stat = statSync(filePath);
    if (!stat.isFile()) continue;
    out[name] = stat.size;
  }
  return out;
}

export function listNestedFiles(dir: string): Record<string, number> {
  mkdirSync(dir, { recursive: true });
  const out: Record<string, number> = {};
  function walk(current: string): void {
    for (const name of readdirSync(current)) {
      const filePath = path.join(current, name);
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        walk(filePath);
        continue;
      }
      if (!stat.isFile()) continue;
      out[path.relative(dir, filePath)] = stat.size;
    }
  }
  walk(dir);
  return out;
}
