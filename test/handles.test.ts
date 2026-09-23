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

  it("rejects @ alone and @ with invalid handle body", () => {
    assert.deepEqual(validateHandle("@"), {
      ok: false,
      reason: "handle is empty after removing @",
    });
    assert.equal(validateHandle("@bad-handle").ok, false);
  });
});

describe("parseHandleList", () => {
  it("deduplicates and splits comma-separated handles", () => {
    const r = parseHandleList("bullmacro, @bullmacro, bearmacro");
    assert.deepEqual(r.valid, ["bullmacro", "bearmacro"]);
    assert.equal(r.invalid.length, 0);
  });

  it("returns valid and invalid handles from a mixed list", () => {
    const r = parseHandleList("bullmacro,@bad-handle,bad-handle");
    assert.deepEqual(r.valid, ["bullmacro"]);
    assert.equal(r.invalid.length, 2);
    assert.ok(r.invalid.some((i) => i.raw === "@bad-handle"));
  });
});
