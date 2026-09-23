import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAssumedDesearchResponse } from "../../src/fetch/desearch/parseAssumedResponse.js";

function validItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    text: "Constructive on equities.",
    created_at: "2026-09-01T12:00:00.000Z",
    url: "https://fixture.x-analyst.local/desearch/p1",
    username: "bullmacro",
    ...overrides,
  };
}

describe("parseAssumedDesearchResponse", () => {
  it("maps a valid assumed posts array", () => {
    const result = parseAssumedDesearchResponse("bullmacro", {
      posts: [validItem()],
      has_more: false,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.posts.length, 1);
      assert.equal(result.posts[0]?.kind, "original");
      assert.equal(result.hasMore, false);
    }
  });

  it("returns empty posts for a valid empty list", () => {
    const result = parseAssumedDesearchResponse("bullmacro", {
      posts: [],
      has_more: false,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.posts.length, 0);
  });

  it("rejects unrecognized top-level shape", () => {
    assert.equal(parseAssumedDesearchResponse("x", { items: [] }).ok, false);
  });

  it("rejects missing required fields", () => {
    const result = parseAssumedDesearchResponse("bullmacro", {
      posts: [{ id: "p1" }],
    });
    assert.equal(result.ok, false);
  });

  it("rejects invalid timestamps and urls", () => {
    assert.equal(
      parseAssumedDesearchResponse("bullmacro", {
        posts: [validItem({ created_at: "not-a-date" })],
      }).ok,
      false,
    );
    assert.equal(
      parseAssumedDesearchResponse("bullmacro", {
        posts: [validItem({ url: "ftp://bad.example/x" })],
      }).ok,
      false,
    );
  });

  it("rejects author handle mismatch and duplicate ids", () => {
    assert.equal(
      parseAssumedDesearchResponse("bullmacro", {
        posts: [validItem({ username: "othermacro" })],
      }).ok,
      false,
    );
    assert.equal(
      parseAssumedDesearchResponse("bullmacro", {
        posts: [validItem({ id: "dup" }), validItem({ id: "dup" })],
      }).ok,
      false,
    );
  });

  it("uses explicit post_kind when provided", () => {
    const result = parseAssumedDesearchResponse("bullmacro", {
      posts: [validItem({ post_kind: "repost", is_retweet: false })],
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.posts[0]?.kind, "repost");
  });

  it("rejects has_more without next_cursor", () => {
    const result = parseAssumedDesearchResponse("bullmacro", {
      posts: [validItem()],
      has_more: true,
    });
    assert.equal(result.ok, false);
  });
});
