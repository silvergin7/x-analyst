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
      assert.equal(quote.posts[0]?.analystComment, "Constructive on equities.");
      assert.equal(quote.posts[0]?.quotedPostText, undefined);
    }
  });

  it("keeps surrounding posts when one item is both a retweet and a quote", () => {
    const result = parseTwitterUserPostsResponse("sampleanalyst", {
      user: {
        id: "1001",
        url: "https://fixture.x-analyst.local/sampleanalyst",
        name: "Sample Analyst",
        username: "sampleanalyst",
      },
      tweets: [
        validTweet({ id: "status-1", user: { username: "sampleanalyst" } }),
        validTweet({
          id: "status-2",
          text: "Rates can stay restrictive.",
          created_at: "2026-10-02T12:00:00.000Z",
          url: "https://fixture.x-analyst.local/status/2",
          user: { username: "sampleanalyst" },
        }),
        validTweet({
          id: "status-3",
          text: "Credit spreads look calm.",
          created_at: "2026-10-04T12:00:00.000Z",
          url: "https://fixture.x-analyst.local/status/3",
          user: { username: "sampleanalyst" },
        }),
        validTweet({
          id: "status-4",
          text: "Inventories are still tight.",
          created_at: "2026-10-06T12:00:00.000Z",
          url: "https://fixture.x-analyst.local/status/4",
          user: { username: "sampleanalyst" },
        }),
        {
          id: "status-5",
          text: "Sharing another account's market note.",
          created_at: "2026-10-08T15:00:00.000Z",
          url: "https://fixture.x-analyst.local/status/5",
          reply_count: 1,
          retweet_count: 2,
          like_count: 3,
          is_quote_tweet: true,
          is_retweet: true,
          user: {
            id: "1001",
            username: "sampleanalyst",
            name: "Sample Analyst",
          },
          quote: {
            id: "quoted-note",
            text: "Quoted text that must not become analyst commentary.",
            is_quote_tweet: false,
            is_retweet: false,
          },
          retweet: {
            id: "reposted-note",
            text: "Reposted text that must not become analyst commentary.",
          },
        },
        validTweet({
          id: "status-6",
          text: "The later original post is still constructive.",
          created_at: "2026-10-09T12:00:00.000Z",
          url: "https://fixture.x-analyst.local/status/6",
          user: { username: "sampleanalyst" },
        }),
      ],
      next_cursor: "",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.posts.map((post) => post.id),
      ["status-1", "status-2", "status-3", "status-4", "status-5", "status-6"],
    );
    const mixed = result.posts[4];
    assert.equal(mixed?.kind, "repost");
    assert.equal(mixed?.typeConflict, "retweet_and_quote");
    assert.equal(mixed?.analystComment, undefined);
    assert.equal(mixed?.text, "Sharing another account's market note.");
    assert.equal(result.posts[5]?.kind, "original");
    assert.equal(result.hasMorePages, false);
  });

  it("uses a quote's own text as commentary and keeps quote.text separate", () => {
    const result = parseTwitterUserPostsResponse("sampleanalyst", {
      tweets: [
        validTweet({
          id: "quote-1",
          text: "  I still see room for duration to rally.  ",
          is_retweet: false,
          is_quote_tweet: true,
          user: { username: "sampleanalyst" },
          quote: {
            id: "quoted-note",
            text: "The quoted account's original market note.",
            is_quote_tweet: false,
            is_retweet: false,
          },
          retweet: {
            text: "This retweet field must not be used as the quoted post.",
          },
        }),
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const post = result.posts[0];
    assert.equal(post?.kind, "quote");
    assert.equal(post?.analystComment, "I still see room for duration to rally.");
    assert.equal(post?.quotedPostText, "The quoted account's original market note.");
    assert.equal(post?.typeConflict, undefined);
  });

  it("keeps a quote with empty own text and does not invent commentary", () => {
    const blank = parseTwitterUserPostsResponse("sampleanalyst", {
      tweets: [
        validTweet({
          id: "quote-blank",
          text: "   ",
          is_retweet: false,
          is_quote_tweet: true,
          user: { username: "sampleanalyst" },
          quote: { text: "Quoted words that stay out of commentary." },
        }),
      ],
    });
    assert.equal(blank.ok, true);
    if (!blank.ok) return;
    assert.equal(blank.posts[0]?.analystComment, undefined);
    assert.equal(blank.posts[0]?.quotedPostText, "Quoted words that stay out of commentary.");

    const missingQuoteText = parseTwitterUserPostsResponse("sampleanalyst", {
      tweets: [
        validTweet({
          id: "quote-own",
          text: "My comment stands alone.",
          is_retweet: false,
          is_quote_tweet: true,
          user: { username: "sampleanalyst" },
          quote: { id: "no-text" },
        }),
      ],
    });
    assert.equal(missingQuoteText.ok, true);
    if (!missingQuoteText.ok) return;
    assert.equal(missingQuoteText.posts[0]?.analystComment, "My comment stands alone.");
    assert.equal(missingQuoteText.posts[0]?.quotedPostText, undefined);
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

  it("flags a non-empty documented media array and ignores item fields", () => {
    const withMedia = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [validTweet({ media: [{ type: "photo", url: "https://example.invalid/secret.jpg" }] })],
    });
    assert.equal(withMedia.ok, true);
    if (withMedia.ok) assert.equal(withMedia.posts[0]?.hasAttachedMedia, true);

    const empty = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [validTweet({ media: [] })],
    });
    assert.equal(empty.ok, true);
    if (empty.ok) assert.equal(empty.posts[0]?.hasAttachedMedia, undefined);

    const missing = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [validTweet()],
    });
    assert.equal(missing.ok, true);
    if (missing.ok) assert.equal(missing.posts[0]?.hasAttachedMedia, undefined);

    const notAnArray = parseTwitterUserPostsResponse("bullmacro", {
      tweets: [validTweet({ media: "photo" })],
    });
    assert.equal(notAnArray.ok, true);
    if (notAnArray.ok) assert.equal(notAnArray.posts[0]?.hasAttachedMedia, undefined);
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
