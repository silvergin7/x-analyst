import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFetchIssue } from "../../src/format/report.js";
import { DesearchPaginationError } from "../../src/fetch/desearch/fetchHandlePages.js";
import {
  DesearchNotConfiguredError,
  DesearchPostsFetcher,
} from "../../src/fetch/desearch/desearchPostsFetcher.js";
import type { DesearchTransport } from "../../src/fetch/desearch/desearchTransport.js";

const FAKE_CREDENTIAL = "unit-test-only-not-a-secret";

function validApiTweet(id: string, username: string, created_at = "2026-09-01T12:00:00.000Z") {
  return {
    id,
    text: `Post ${id}`,
    created_at,
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
  it("counts an identical duplicate inside one page and rejects different content", async () => {
    const id = "2104906619062538582";
    const same = validApiTweet(id, "bullmacro", "Fri Oct 09 12:12:07 +0000 2026");
    const transport: DesearchTransport = {
      async execute() {
        return { status: 200, body: tweetsBody([same, { ...same }]) };
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
      ["bullmacro"],
      { maxPostsPerPerson: 10, maxPostsTotal: 10 },
      { lookbackCutoffMs: Date.parse("2026-09-10T00:00:00.000Z") },
    );
    assert.equal(outcomes[0]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.equal(outcomes[0].duplicatePostsRemoved, 1);
      assert.equal(outcomes[0].posts.length, 1);
    }

    const conflicting: DesearchTransport = {
      async execute() {
        return {
          status: 200,
          body: tweetsBody([same, { ...same, text: "Different wording." }]),
        };
      },
    };
    const failing = new DesearchPostsFetcher({
      transport: conflicting,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 1,
    });
    await assert.rejects(
      () =>
        failing.fetchForHandles(
          ["bullmacro"],
          { maxPostsPerPerson: 10, maxPostsTotal: 10 },
          { lookbackCutoffMs: Date.parse("2026-09-10T00:00:00.000Z") },
        ),
      /duplicate post id 2104906619062538582 has different content/,
    );
  });

  it("removes a post id repeated on a later page", async () => {
    const id = "2104906619062538582";
    let call = 0;
    const transport: DesearchTransport = {
      async execute() {
        call += 1;
        if (call === 1) {
          return {
            status: 200,
            body: tweetsBody(
              [
                {
                  ...validApiTweet(id, "bullmacro", "Fri Oct 09 12:12:07 +0000 2026"),
                  text: "First copy of the repeated post.",
                },
              ],
              "page-2",
            ),
          };
        }
        return {
          status: 200,
          body: tweetsBody([
            {
              ...validApiTweet(id, "bullmacro", "Fri Oct 09 12:12:07 +0000 2026"),
              text: "Later copy that must be dropped.",
            },
            validApiTweet("older", "bullmacro", "2026-09-01T00:00:00.000Z"),
          ]),
        };
      },
    };
    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 3,
    });
    const outcomes = await fetcher.fetchForHandles(
      ["bullmacro"],
      { maxPostsPerPerson: 10, maxPostsTotal: 10 },
      { lookbackCutoffMs: Date.parse("2026-09-10T00:00:00.000Z") },
    );
    assert.equal(call, 2);
    assert.equal(outcomes[0]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.equal(outcomes[0].duplicatePostsRemoved, 1);
      assert.deepEqual(
        outcomes[0].posts.map((item) => item.id),
        [id, "older"],
      );
      assert.equal(outcomes[0].posts[0]?.text, "First copy of the repeated post.");
    }
  });

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

  it("stops when the oldest post on a page is past the lookback window", async () => {
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
              [
                validApiTweet("old-id", "bullmacro", "Mon Oct 05 01:00:00 +0000 2026"),
                validApiTweet("new-id", "bullmacro", "Fri Oct 09 05:35:09 +0000 2026"),
              ],
              "page-2",
            ),
          };
        }
        return {
          status: 200,
          body: tweetsBody(
            [
              validApiTweet("boundary", "bullmacro", "2026-09-20T00:00:00.000Z"),
              validApiTweet("past", "bullmacro", "2026-09-01T00:00:00.000Z"),
            ],
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

    const outcomes = await fetcher.fetchForHandles(
      ["bullmacro"],
      { maxPostsPerPerson: 1, maxPostsTotal: 1 },
      { lookbackCutoffMs: Date.parse("2026-09-10T00:00:00.000Z") },
    );
    assert.equal(call, 2);
    assert.equal(outcomes[0]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.deepEqual(
        outcomes[0].posts.map((post) => post.id),
        ["new-id", "old-id", "boundary", "past"],
      );
      assert.equal(outcomes[0].retrievalComplete, true);
      assert.equal(outcomes[0].incompleteReason, undefined);
      assert.equal(outcomes[0].fetchStopReason, "lookback_window_reached");
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
      assert.equal(outcomes[0].fetchStopReason, "desearch_request_budget_exhausted");
    }
  });

  it("still fetches a later handle when the kept post count is already high", async () => {
    let calls = 0;
    const transport: DesearchTransport = {
      async execute(request) {
        calls += 1;
        const username = new URL(request.url).searchParams.get("username") ?? "bullmacro";
        return {
          status: 200,
          body: tweetsBody([validApiTweet(`${username}-1`, username)]),
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
    assert.equal(calls, 2);
    assert.equal(outcomes[0]?.status, "ok");
    assert.equal(outcomes[1]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.equal(outcomes[0].fetchStopReason, "no_more_pages");
    }
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
      assert.equal(outcomes[0].fetchStopReason, "no_more_pages");
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

  it("stops each of three handles at the lower of the per-handle cap and the remaining run budget", async () => {
    const calls: string[] = [];
    const transport: DesearchTransport = {
      async execute(request) {
        const username = new URL(request.url).searchParams.get("username");
        assert.equal(typeof username, "string");
        const handle = username as string;
        calls.push(handle);
        const n = calls.filter((item) => item === handle).length;
        return {
          status: 200,
          body: tweetsBody(
            [validApiTweet(`${handle}-${n}`, handle, "2026-10-09T00:00:00.000Z")],
            `more-${handle}-${n}`,
          ),
        };
      },
    };
    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 5,
      maxRequestsPerHandle: 2,
    });
    const outcomes = await fetcher.fetchForHandles(
      ["alpha", "beta", "gamma"],
      { maxPostsPerPerson: 10, maxPostsTotal: 50 },
    );
    assert.deepEqual(calls, ["alpha", "alpha", "beta", "beta", "gamma"]);
    assert.equal(outcomes.length, 3);
    const expected = [
      { handle: "alpha", posts: 2, reason: "desearch_handle_request_limit_reached", label: "per-handle request limit reached" },
      { handle: "beta", posts: 2, reason: "desearch_handle_request_limit_reached", label: "per-handle request limit reached" },
      { handle: "gamma", posts: 1, reason: "desearch_request_budget_exhausted", label: "run request limit reached" },
    ] as const;
    for (const [index, want] of expected.entries()) {
      const outcome = outcomes[index];
      assert.equal(outcome?.status, "ok");
      if (outcome?.status !== "ok") continue;
      assert.equal(outcome.handle, want.handle);
      assert.equal(outcome.posts.length, want.posts);
      assert.equal(outcome.retrievalComplete, false);
      assert.equal(outcome.fetchStopReason, want.reason);
      assert.equal(outcome.incompleteReason, want.reason);
      assert.match(formatFetchIssue(outcome, "desearch"), new RegExp(want.label));
    }
  });
});
