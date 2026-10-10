import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_HANDLES, DEFAULT_QUESTION } from "../src/config.js";
import { parseCliArgs } from "../src/cliArgs.js";

describe("parseCliArgs", () => {
  it("uses documented defaults when no flags are passed", () => {
    const opts = parseCliArgs([]);
    assert.deepEqual(opts.handles, [...DEFAULT_HANDLES]);
    assert.equal(opts.question, DEFAULT_QUESTION);
    assert.equal(opts.flagErrors.length, 0);
  });

  it("parses custom comma-separated handles and question", () => {
    const opts = parseCliArgs([
      "--handles",
      "bullmacro,bearmacro",
      "--question",
      "Custom question?",
    ]);
    assert.deepEqual(opts.handles, ["bullmacro", "bearmacro"]);
    assert.equal(opts.question, "Custom question?");
    assert.equal(opts.flagErrors.length, 0);
  });

  it("deduplicates handles from CLI input", () => {
    const opts = parseCliArgs(["--handles", "bullmacro,@bullmacro"]);
    assert.deepEqual(opts.handles, ["bullmacro"]);
  });

  it("reports missing value for --handles instead of silently using defaults", () => {
    const opts = parseCliArgs(["--handles"]);
    assert.ok(opts.flagErrors.some((e) => e.includes("--handles")));
    assert.deepEqual(opts.handles, []);
  });

  it("reports missing value for --question", () => {
    const opts = parseCliArgs(["--question"]);
    assert.ok(opts.flagErrors.some((e) => e.includes("--question")));
    assert.equal(opts.question, "");
  });

  it("reports empty --handles= value", () => {
    const opts = parseCliArgs(["--handles="]);
    assert.ok(opts.flagErrors.length > 0);
  });

  it("reports empty --handles with separate empty string argument", () => {
    const opts = parseCliArgs(["--handles", ""]);
    assert.ok(opts.flagErrors.some((e) => e.includes("Empty value for --handles")));
    assert.deepEqual(opts.handles, []);
  });

  it("reports empty --question with separate empty string argument", () => {
    const opts = parseCliArgs(["--question", ""]);
    assert.ok(opts.flagErrors.some((e) => e.includes("Empty value for --question")));
    assert.equal(opts.question, "");
  });

  it("parses --handles=value and --question=value forms", () => {
    const opts = parseCliArgs([
      "--handles=bullmacro,bearmacro",
      "--question=What now?",
    ]);
    assert.deepEqual(opts.handles, ["bullmacro", "bearmacro"]);
    assert.equal(opts.question, "What now?");
    assert.equal(opts.flagErrors.length, 0);
    assert.equal(opts.fresh, false);
    assert.equal(opts.asOf, undefined);
  });

  it("parses --fresh and a real --as-of date", () => {
    const opts = parseCliArgs(["--fresh", "--as-of", "2026-10-09"]);
    assert.equal(opts.fresh, true);
    assert.equal(opts.asOf, "2026-10-09");
    assert.equal(opts.flagErrors.length, 0);
  });

  it("rejects an impossible --as-of date", () => {
    const opts = parseCliArgs(["--as-of", "2026-02-31"]);
    assert.ok(opts.flagErrors.some((error) => error.includes("--as-of")));
    assert.equal(opts.asOf, undefined);
  });
});
