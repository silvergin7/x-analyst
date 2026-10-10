import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DesearchPaginationError } from "../../src/fetch/desearch/fetchHandlePages.js";
import {
  DesearchNotConfiguredError,
  DesearchPostsFetcher,
} from "../../src/fetch/desearch/desearchPostsFetcher.js";
import type { DesearchTransport } from "../../src/fetch/desearch/desearchTransport.js";

const FAKE_CREDENTIAL = "unit-test-only-not-a-secret";

function validApiTweet(id: string, username: string) {
  return {
    id,
    text: `Post ${id}`,
    created_at: "2026-09-01T12:00:00.000Z",
    url: `https://fixture.x-analyst.local/desearch/${username}/${id}`,
    is_retweet: false,
    is_quote_tweet: false,
    user: { username },
  };
}

function tweetsBody(tweets: unknown[], next_cursor?: string) {
  return { tweets, ...(next_cursor !== undefined ? { next_cursor } : {}) };
}

describe("DesearchPostsFetcher", () => {
  it("throws when live mode is not eligible", () => {
    assert.throws(
      () =>
        new DesearchPostsFetcher({
          transport: { execute: async () => ({ status: 200, body: {} }) },
          settings: { hasUsableCredential: false, liveEligible: false },
        }),
      DesearchNotConfiguredError,
    );
  });

  it("keeps every post from paid pages and does not request another page after the cap", async () => {
    let call = 0;
    const transport: DesearchTransport = {
      async execute(request) {
        call += 1;
        assert.doesNotMatch(request.url, /unit-test-only-not-a-secret/);
        assert.equal(new URL(request.url).searchParams.has("limit"), false);
        if (call === 1) {
          return {
            status: 200,
            body: tweetsBody(
              [validApiTweet("1", "bullmacro"), validApiTweet("2", "bullmacro")],
              "page-2",
            ),
          };
        }
        return {
          status: 200,
          body: tweetsBody(
            [validApiTweet("3", "bullmacro"), validApiTweet("4", "bullmacro")],
            "page-3",
          ),
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 10,
    });

    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 3,
      maxPostsTotal: 10,
    });
    assert.equal(call, 2);
    assert.equal(outcomes[0]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.deepEqual(
        outcomes[0].posts.map((post) => post.id),
        ["1", "2", "3", "4"],
      );
      assert.equal(outcomes[0].retrievalComplete, false);
      assert.equal(outcomes[0].incompleteReason, "per_person_limit_reached");
    }
  });

  it("stops pagination when request budget is exhausted", async () => {
    let call = 0;
    const transport: DesearchTransport = {
      async execute() {
        call += 1;
        return {
          status: 200,
          body: tweetsBody([validApiTweet("1", "bullmacro")], "more"),
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 1,
    });

    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 10,
      maxPostsTotal: 10,
    });
    assert.equal(call, 1);
    assert.equal(outcomes[0]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.equal(outcomes[0].retrievalComplete, false);
      assert.equal(outcomes[0].incompleteReason, "desearch_request_budget_exhausted");
    }
  });

  it("does not call transport for later handle after total cap exhausted", async () => {
    let calls = 0;
    const transport: DesearchTransport = {
      async execute() {
        calls += 1;
        return {
          status: 200,
          body: tweetsBody([validApiTweet("1", "bullmacro")]),
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 5,
    });

    const outcomes = await fetcher.fetchForHandles(
      ["bullmacro", "bearmacro"],
      { maxPostsPerPerson: 10, maxPostsTotal: 1 },
    );
    assert.equal(calls, 1);
    assert.equal(outcomes[1]?.status, "incomplete");
  });

  it("skips later handle when request budget already exhausted", async () => {
    let calls = 0;
    const transport: DesearchTransport = {
      async execute() {
        calls += 1;
        return {
          status: 200,
          body: tweetsBody([validApiTweet("1", "bullmacro")], "more"),
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 1,
    });

    const outcomes = await fetcher.fetchForHandles(
      ["bullmacro", "bearmacro"],
      { maxPostsPerPerson: 10, maxPostsTotal: 20 },
    );
    assert.equal(calls, 1);
    assert.equal(outcomes[1]?.status, "incomplete");
    if (outcomes[1]?.status === "incomplete") {
      assert.equal(outcomes[1].reason, "desearch_request_budget_exhausted");
    }
  });

  it("keeps every post from a paid response that has no next page", async () => {
    const transport: DesearchTransport = {
      async execute() {
        return {
          status: 200,
          body: tweetsBody([
            validApiTweet("1", "bullmacro"),
            validApiTweet("2", "bullmacro"),
            validApiTweet("3", "bullmacro"),
            validApiTweet("4", "bullmacro"),
          ]),
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 5,
    });

    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 2,
      maxPostsTotal: 10,
    });
    assert.equal(outcomes[0]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.equal(outcomes[0].posts.length, 4);
      assert.equal(outcomes[0].retrievalComplete, true);
      assert.equal(outcomes[0].incompleteReason, undefined);
    }
  });

  it("keeps every post from a paid response that exceeds the total cap and has no next page", async () => {
    const transport: DesearchTransport = {
      async execute() {
        return {
          status: 200,
          body: tweetsBody([
            validApiTweet("1", "bullmacro"),
            validApiTweet("2", "bullmacro"),
            validApiTweet("3", "bullmacro"),
          ]),
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 5,
    });

    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 10,
      maxPostsTotal: 2,
    });
    assert.equal(outcomes[0]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.equal(outcomes[0].posts.length, 3);
      assert.equal(outcomes[0].retrievalComplete, true);
      assert.equal(outcomes[0].incompleteReason, undefined);
    }
  });

  it("reports complete retrieval when final page has no next_cursor at cap", async () => {
    let call = 0;
    const transport: DesearchTransport = {
      async execute() {
        call += 1;
        if (call === 1) {
          return {
            status: 200,
            body: tweetsBody([validApiTweet("1", "bullmacro")], "page-2"),
          };
        }
        return {
          status: 200,
          body: tweetsBody([
            validApiTweet("2", "bullmacro"),
            validApiTweet("3", "bullmacro"),
          ]),
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 5,
    });

    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 3,
      maxPostsTotal: 10,
    });
    assert.equal(call, 2);
    assert.equal(outcomes[0]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.equal(outcomes[0].posts.length, 3);
      assert.equal(outcomes[0].retrievalComplete, true);
      assert.equal(outcomes[0].incompleteReason, undefined);
    }
  });

  it("continues past an empty tweets page when next_cursor is present", async () => {
    let call = 0;
    const transport: DesearchTransport = {
      async execute() {
        call += 1;
        if (call === 1) {
          return { status: 200, body: tweetsBody([], "page-2") };
        }
        return {
          status: 200,
          body: tweetsBody([validApiTweet("1", "bullmacro")]),
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 5,
    });

    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 10,
      maxPostsTotal: 10,
    });
    assert.equal(call, 2);
    assert.equal(outcomes[0]?.status, "ok");
  });

  it("does not report empty when cursor remains but request budget is exhausted", async () => {
    const transport: DesearchTransport = {
      async execute() {
        return { status: 200, body: tweetsBody([], "page-2") };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 1,
    });

    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 10,
      maxPostsTotal: 10,
    });
    assert.equal(outcomes[0]?.status, "incomplete");
    if (outcomes[0]?.status === "incomplete") {
      assert.equal(outcomes[0].reason, "desearch_request_budget_exhausted");
    }
  });

  it("fails closed on repeated cursor", async () => {
    const transport: DesearchTransport = {
      async execute() {
        return {
          status: 200,
          body: tweetsBody([], "same-cursor"),
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 5,
    });

    await assert.rejects(
      () =>
        fetcher.fetchForHandles(["bullmacro"], {
          maxPostsPerPerson: 10,
          maxPostsTotal: 10,
        }),
      DesearchPaginationError,
    );
  });

  it("returns empty for valid empty tweets list without cursor", async () => {
    const transport: DesearchTransport = {
      async execute() {
        return { status: 200, body: tweetsBody([]) };
      },
    };
    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 5,
    });
    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 10,
      maxPostsTotal: 10,
    });
    assert.equal(outcomes[0]?.status, "empty");
  });
});
