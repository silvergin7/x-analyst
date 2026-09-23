import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockPostsFetcher } from "../src/fetch/postsFetcher.js";

describe("MockPostsFetcher", () => {
  const fetcher = new MockPostsFetcher();

  it("enforces per-person post cap", async () => {
    const outcomes = await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 2,
      maxPostsTotal: 100,
    });
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]?.status, "ok");
    if (outcomes[0]?.status === "ok") {
      assert.equal(outcomes[0].posts.length, 2);
      assert.equal(outcomes[0].retrievalComplete, false);
      assert.equal(outcomes[0].incompleteReason, "per_person_limit_reached");
    }
  });

  it("enforces total post cap across handles", async () => {
    const outcomes = await fetcher.fetchForHandles(
      ["bullmacro", "bearmacro"],
      { maxPostsPerPerson: 10, maxPostsTotal: 4 },
    );
    const ok = outcomes.filter((o) => o.status === "ok");
    const total = ok.reduce(
      (n, o) => n + (o.status === "ok" ? o.posts.length : 0),
      0,
    );
    assert.equal(total, 4);
    if (ok[0]?.status === "ok") assert.equal(ok[0].posts.length, 3);
    if (ok[1]?.status === "ok") {
      assert.equal(ok[1].posts.length, 1);
      assert.equal(ok[1].retrievalComplete, false);
      assert.equal(ok[1].incompleteReason, "total_post_limit_reached");
    }
  });

  it("marks later handles incomplete when total limit is exhausted first", async () => {
    const outcomes = await fetcher.fetchForHandles(
      ["bullmacro", "bearmacro", "unclearmacro"],
      { maxPostsPerPerson: 10, maxPostsTotal: 3 },
    );
    assert.deepEqual(
      outcomes.map((o) => o.status),
      ["ok", "incomplete", "incomplete"],
    );
    if (outcomes[1]?.status === "incomplete") {
      assert.equal(outcomes[1].reason, "total_post_limit_reached");
    }
  });

  it("reports invalid, unknown, and empty handles honestly", async () => {
    const outcomes = await fetcher.fetchForHandles(
      ["", "unknownmacro", "emptymacro"],
      { maxPostsPerPerson: 10, maxPostsTotal: 50 },
    );
    assert.deepEqual(
      outcomes.map((o) => o.status),
      ["invalid_handle", "unknown_handle", "empty"],
    );
  });
});
