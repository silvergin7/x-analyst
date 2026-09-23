import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHandleList, validateHandle } from "../src/validation/handles.js";

describe("validateHandle", () => {
  it("accepts normalized handles", () => {
    assert.deepEqual(validateHandle("bullmacro"), {
      ok: true,
      normalized: "bullmacro",
    });
    assert.deepEqual(validateHandle("@BearMacro"), {
      ok: true,
      normalized: "bearmacro",
    });
  });

  it("rejects empty and invalid characters", () => {
    assert.equal(validateHandle("").ok, false);
    assert.equal(validateHandle("bad-handle").ok, false);
    assert.equal(validateHandle("waytoolonghandlehere").ok, false);
  });
});

describe("parseHandleList", () => {
  it("deduplicates and splits comma-separated handles", () => {
    const r = parseHandleList("bullmacro, @bullmacro, bearmacro");
    assert.deepEqual(r.valid, ["bullmacro", "bearmacro"]);
    assert.equal(r.invalid.length, 0);
  });
});
