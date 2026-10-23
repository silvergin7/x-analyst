import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { EnvFileError, loadEnvFileIntoProcess } from "../src/runtime/loadEnvFile.js";

describe("loadEnvFileIntoProcess", () => {
  it("does not override variables already set in the shell environment", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "env-file-"));
    const filePath = path.join(dir, ".env");
    writeFileSync(filePath, "SHELL_WINS=file-value\nFROM_FILE=inside\n", "utf8");
    const env: NodeJS.ProcessEnv = { SHELL_WINS: "shell-value" };
    loadEnvFileIntoProcess(filePath, env);
    assert.equal(env.SHELL_WINS, "shell-value");
    assert.equal(env.FROM_FILE, "inside");
  });

  it("fails on an unparseable line with the line number", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "env-file-bad-"));
    const filePath = path.join(dir, ".env");
    writeFileSync(filePath, "OK=1\nnot-a-valid-line\n", "utf8");
    assert.throws(
      () => loadEnvFileIntoProcess(filePath, {}),
      (err: unknown) =>
        err instanceof EnvFileError && /line 2/.test(err.message) && !/not-a-valid-line/.test(err.message),
    );
  });
});
