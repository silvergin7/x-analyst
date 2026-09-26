import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTwitterUserPostsResponse } from "../../src/fetch/desearch/parseAssumedResponse.js";

function validTweet(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    text: "Constructive on equities.",
    created_at: "2026-09-01T12:00:00.000Z",
    url: "https://fixture.x-analyst.local/desearch/p1",
    is_retweet: false,
    is_quote_tweet: false,
    user: { username: "bullmacro" },
    ...overrides,
  };
}

describe("parseTwitterUserPostsResponse", () => {
  it("maps documented tweets array with nested username", () => {
    const result = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [validTweet()],
      next_cursor: "",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.posts.length, 1);
      assert.equal(result.posts[0]?.kind, "original");
      assert.equal(result.hasMorePages, false);
    }
  });

  it("returns empty posts for empty tweets", () => {
    const result = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [],
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.posts.length, 0);
  });

  it("rejects missing tweets", () => {
    assert.equal(parseTwitterUserPostsResponse("x", { user: {} }).ok, false);
  });

  it("rejects missing required fields", () => {
    const result = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [{ id: "p1" }],
    });
    assert.equal(result.ok, false);
  });

  it("rejects missing kind booleans", () => {
    const result = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [validTweet({ is_retweet: undefined })],
    });
    assert.equal(result.ok, false);
  });

  it("rejects non-boolean kind flags", () => {
    const result = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [validTweet({ is_retweet: "false", is_quote_tweet: false })],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /must be booleans/);
    }
  });

  it("maps is_retweet and is_quote_tweet without inventing commentary", () => {
    const repost = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [validTweet({ is_retweet: true, is_quote_tweet: false })],
    });
    assert.equal(repost.ok, true);
    if (repost.ok) assert.equal(repost.posts[0]?.kind, "repost");

    const quote = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [validTweet({ is_retweet: false, is_quote_tweet: true })],
    });
    assert.equal(quote.ok, true);
    if (quote.ok) {
      assert.equal(quote.posts[0]?.kind, "quote");
      assert.equal(quote.posts[0]?.analystComment, undefined);
    }
  });

  it("rejects non-string next_cursor", () => {
    const result = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [],
      next_cursor: 123,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /next_cursor must be a string/);
  });

  it("detects more pages from next_cursor only", () => {
    const result = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [validTweet()],
      next_cursor: "page-2",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.hasMorePages, true);
      assert.equal(result.nextCursor, "page-2");
    }
  });

  it("rejects author username mismatch and duplicate ids", () => {
    assert.equal(
      parseTwitterUserPostsResponse("bullmacro", {
        tweets: [validTweet({ user: { username: "othermacro" } })],
      }).ok,
      false,
    );
    assert.equal(
      parseTwitterUserPostsResponse("bullmacro", {
        tweets: [validTweet({ id: "dup" }), validTweet({ id: "dup" })],
      }).ok,
      false,
    );
  });
});
