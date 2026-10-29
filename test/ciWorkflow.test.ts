import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

const ENV_KEYS = [
  "DESEARCH_LIVE_ENABLED",
  "LLM_LIVE_ENABLED",
  "DESEARCH_API_KEY",
  "CHUTES_API_KEY",
] as const;

const ENV_LINE: Record<(typeof ENV_KEYS)[number], RegExp> = {
  DESEARCH_LIVE_ENABLED: /^\s*DESEARCH_LIVE_ENABLED:\s*"false"\s*$/,
  LLM_LIVE_ENABLED: /^\s*LLM_LIVE_ENABLED:\s*"false"\s*$/,
  DESEARCH_API_KEY: /^\s*DESEARCH_API_KEY:\s*""\s*$/,
  CHUTES_API_KEY: /^\s*CHUTES_API_KEY:\s*""\s*$/,
};

function loadCiWorkflow(): string {
  return readFileSync(ciPath, "utf8");
}

function countKeyOccurrences(text: string, key: string): number {
  const pattern = new RegExp(`\\b${key}\\b`, "g");
  return [...text.matchAll(pattern)].length;
}

function lineForKey(text: string, key: string): string | undefined {
  return text.split("\n").find((line) => new RegExp(`\\b${key}\\b`).test(line));
}

describe("GitHub Actions ci workflow", () => {
  it("live provider env keys appear once with forced-off values", () => {
    const text = loadCiWorkflow();
    for (const key of ENV_KEYS) {
      assert.equal(
        countKeyOccurrences(text, key),
        1,
        `expected ${key} exactly once in ci.yml`,
      );
      const line = lineForKey(text, key);
      assert.ok(line, `missing line for ${key}`);
      assert.match(line, ENV_LINE[key], `unexpected line for ${key}: ${line}`);
    }
  });

  it("no secrets, pull_request_target or expressions", () => {
    const text = loadCiWorkflow();
    assert.doesNotMatch(text, /secrets|pull_request_target|\$\{\{/);
  });

  it("permissions are contents: read only", () => {
    const text = loadCiWorkflow();
    const lines = text.split("\n");
    const permissionLineIndices = lines.reduce<number[]>((indices, line, index) => {
      if (/^\s*permissions\s*:/.test(line)) {
        indices.push(index);
      }
      return indices;
    }, []);
    assert.equal(
      permissionLineIndices.length,
      1,
      "permissions: must appear exactly once in ci.yml",
    );
    const permLine = lines[permissionLineIndices[0]!]!;
    assert.equal(
      permLine,
      "permissions:",
      "permissions line must be exactly permissions: at column 0",
    );
    const blockNonEmpty: string[] = [];
    for (let i = permissionLineIndices[0]! + 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.trim() === "") {
        continue;
      }
      if (!/^\s/.test(line)) {
        break;
      }
      blockNonEmpty.push(line);
    }
    assert.deepEqual(
      blockNonEmpty,
      ["  contents: read"],
      "permissions block must be exactly one line: contents: read",
    );
  });
});
