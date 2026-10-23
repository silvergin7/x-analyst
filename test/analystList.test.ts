import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AnalystListError,
  loadAnalystList,
  parseAnalystListJson,
} from "../src/config/analystList.js";
import { parseHandleListStrict } from "../src/validation/handlesStrict.js";

describe("analyst list", () => {
  it("loads the committed config/analysts.json roster", () => {
    const entries = loadAnalystList({});
    assert.ok(entries.length >= 3);
    assert.ok(entries.some((entry) => entry.handle === "lynaldencontact"));
  });

  it("accepts the committed roster shape", () => {
    const entries = parseAnalystListJson(
      JSON.stringify({
        analysts: [
          { handle: "LynAldenContact", notes: "Macro" },
          { handle: "ClassicDavid3" },
          { handle: "MulderSonny" },
        ],
      }),
    );
    assert.equal(entries.length, 3);
    assert.equal(entries[0]?.handle, "lynaldencontact");
  });

  it("rejects an empty analysts array", () => {
    assert.throws(
      () => parseAnalystListJson(JSON.stringify({ analysts: [] })),
      AnalystListError,
    );
  });

  it("rejects duplicate handles case-insensitively", () => {
    assert.throws(
      () =>
        parseAnalystListJson(
          JSON.stringify({
            analysts: [{ handle: "LynAldenContact" }, { handle: "lynaldencontact" }],
          }),
        ),
      AnalystListError,
    );
  });

  it("rejects unknown fields on the root and entries", () => {
    assert.throws(
      () => parseAnalystListJson(JSON.stringify({ analysts: [], extra: true })),
      AnalystListError,
    );
    assert.throws(
      () =>
        parseAnalystListJson(
          JSON.stringify({ analysts: [{ handle: "ClassicDavid3", extra: true }] }),
        ),
      AnalystListError,
    );
  });

  it("mutation: strict handle parsing rejects duplicate comma list entries", () => {
    const parsed = parseHandleListStrict("bullmacro,BullMacro");
    assert.equal(parsed.valid.length, 1);
    assert.equal(parsed.invalid[0]?.reason, "duplicate handle");
  });
});
