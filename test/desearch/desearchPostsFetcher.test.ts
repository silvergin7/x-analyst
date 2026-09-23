import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRequestLimit } from "../../src/fetch/desearch/buildRequest.js";
import {
  DesearchNotConfiguredError,
  DesearchPostsFetcher,
} from "../../src/fetch/desearch/desearchPostsFetcher.js";
import type { DesearchTransport } from "../../src/fetch/desearch/desearchTransport.js";

const FAKE_CREDENTIAL = "unit-test-only-not-a-secret";

function validApiPost(id: string, handle: string) {
  return {
    id,
    text: `Post ${id}`,
    created_at: "2026-09-01T12:00:00.000Z",
    url: `https://fixture.x-analyst.local/desearch/${handle}/${id}`,
    username: handle,
  };
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

  it("never requests more than the remaining cap", async () => {
    const limits: number[] = [];
    const transport: DesearchTransport = {
      async execute(request) {
        limits.push(readRequestLimit(request));
        assert.doesNotMatch(request.url, /unit-test-only-not-a-secret/);
        return {
          status: 200,
          body: { posts: [validApiPost("1", "bullmacro")], has_more: false },
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
    });

    await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 5,
      maxPostsTotal: 2,
    });
    assert.deepEqual(limits, [2]);
  });

  it("paginates until cap and marks incomplete when API has more", async () => {
    let call = 0;
    const transport: DesearchTransport = {
      async execute(request) {
        call += 1;
        const limit = readRequestLimit(request);
        assert.ok(limit <= 3);
        if (call === 1) {
          return {
            status: 200,
            body: {
              posts: [validApiPost("1", "bullmacro"), validApiPost("2", "bullmacro")],
              has_more: true,
              next_cursor: "page-2",
            },
          };
        }
        return {
          status: 200,
          body: {
            posts: [validApiPost("3", "bullmacro")],
            has_more: false,
          },
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
    });

    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 3,
      maxPostsTotal: 10,
    });
    assert.equal(call, 2);
    assert.equal(outcomes[0]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.equal(outcomes[0].posts.length, 3);
      assert.equal(outcomes[0].retrievalComplete, false);
      assert.equal(outcomes[0].incompleteReason, "per_person_limit_reached");
    }
  });

  it("does not call transport for later handle after total cap exhausted", async () => {
    let calls = 0;
    const transport: DesearchTransport = {
      async execute() {
        calls += 1;
        return {
          status: 200,
          body: { posts: [validApiPost("1", "bullmacro")], has_more: false },
        };
      },
    };

    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
    });

    const outcomes = await fetcher.fetchForHandles(
      ["bullmacro", "bearmacro"],
      { maxPostsPerPerson: 10, maxPostsTotal: 1 },
    );
    assert.equal(calls, 1);
    assert.equal(outcomes[1]?.status, "incomplete");
  });

  it("returns empty for valid empty API list", async () => {
    const transport: DesearchTransport = {
      async execute() {
        return {
          status: 200,
          body: { posts: [], has_more: false },
        };
      },
    };
    const fetcher = new DesearchPostsFetcher({
      transport,
      requireLiveEligible: false,
      settings: { hasUsableCredential: true, liveEligible: true },
      credential: FAKE_CREDENTIAL,
    });
    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 10,
      maxPostsTotal: 10,
    });
    assert.equal(outcomes[0]?.status, "empty");
  });
});
