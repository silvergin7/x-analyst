import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchOutcomeFailsExit } from "../src/runtime/fetchExitCode.js";
import { DesearchPostsFetcher } from "../src/fetch/desearch/desearchPostsFetcher.js";
import {
  DesearchRetrievalError,
  type DesearchTransport,
} from "../src/fetch/desearch/desearchTransport.js";
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

describe("fetchOutcomeFailsExit", () => {
  it("fails exit for retrieval_failed and desearch_page_no_valid_posts incomplete", () => {
    assert.equal(
      fetchOutcomeFailsExit({
        status: "retrieval_failed",
        handle: "x",
        failureCategory: "http_status",
        reason: "HTTP",
      }),
      true,
    );
    assert.equal(
      fetchOutcomeFailsExit({
        status: "incomplete",
        handle: "x",
        reason: "desearch_page_no_valid_posts",
      }),
      true,
    );
  });

  it("fails exit for ok partial outcomes from DesearchPostsFetcher", async () => {
    let call = 0;
    const transport: DesearchTransport = {
      async execute() {
        call += 1;
        if (call === 1) {
          return {
            status: 200,
            body: tweetsBody(
              [validApiTweet("p1", "bullmacro", "2026-10-09T00:00:00.000Z")],
              "page-2",
            ),
          };
        }
        throw new DesearchRetrievalError("Desearch request timed out.", {
          category: "timeout",
          billing: [],
        });
      },
    };
    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 3,
    });
    const interrupted = await fetcher.fetchForHandles(
      ["bullmacro"],
      { maxPostsPerPerson: 10, maxPostsTotal: 10 },
    );
    assert.equal(interrupted[0]?.status, "ok");
    assert.equal(fetchOutcomeFailsExit(interrupted[0]!), true);

    let page = 0;
    const invalidPage2: DesearchTransport = {
      async execute() {
        page += 1;
        if (page === 1) {
          return {
            status: 200,
            body: tweetsBody(
              [validApiTweet("good", "bullmacro", "2026-10-09T00:00:00.000Z")],
              "cursor-2",
            ),
          };
        }
        return {
          status: 200,
          body: tweetsBody([validApiTweet("bad", "othermacro"), { id: "incomplete" }]),
        };
      },
    };
    const fetcher2 = new DesearchPostsFetcher({
      transport: invalidPage2,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
      maxRequestsPerRun: 3,
    });
    const invalidSecond = await fetcher2.fetchForHandles(
      ["bullmacro"],
      { maxPostsPerPerson: 10, maxPostsTotal: 10 },
    );
    assert.equal(invalidSecond[0]?.status, "ok");
    if (invalidSecond[0]?.status === "ok") {
      assert.equal(invalidSecond[0].incompleteReason, "desearch_page_no_valid_posts");
      assert.equal(invalidSecond[0].posts.length, 1);
    }
    assert.equal(fetchOutcomeFailsExit(invalidSecond[0]!), true);
  });

  it("does not fail exit for request budget exhaustion", () => {
    const outcome = {
      status: "incomplete" as const,
      handle: "x",
      reason: "desearch_request_budget_exhausted" as const,
    };
    assert.equal(fetchOutcomeFailsExit(outcome), false);
  });

  it("mutation: retrieval_failed must fail exit", () => {
    assert.equal(
      fetchOutcomeFailsExit({
        status: "retrieval_failed",
        handle: "x",
        failureCategory: "network",
        reason: "down",
      }),
      true,
    );
  });

  it("mutation: ok desearch_retrieval_interrupted must fail exit", () => {
    assert.equal(
      fetchOutcomeFailsExit({
        status: "ok",
        handle: "x",
        posts: [],
        retrievalComplete: false,
        incompleteReason: "desearch_retrieval_interrupted",
      }),
      true,
    );
  });
});
