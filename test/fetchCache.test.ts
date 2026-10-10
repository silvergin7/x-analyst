import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFetchSliceCache } from "../src/runtime/fetchCache.js";
import type { FetchOutcome } from "../src/types.js";

function outcome(handle: string): FetchOutcome {
  return { status: "empty", handle };
}

describe("createFetchSliceCache", () => {
  it("reuses the same key and replaces a different key", () => {
    const times = ["2026-11-02T12:00:00.000Z", "2026-11-02T13:00:00.000Z"];
    let tick = 0;
    const cache = createFetchSliceCache(
      () => new Date(times[Math.min(tick++, times.length - 1)]!),
    );
    const first = cache.store("alpha", [outcome("bullmacro")]);
    assert.equal(cache.read("alpha")?.fetchedAt, first.fetchedAt);
    assert.equal(cache.read("alpha")?.outcomes[0]?.handle, "bullmacro");

    const second = cache.store("beta", [outcome("bearmacro")]);
    assert.equal(cache.read("alpha"), undefined);
    assert.equal(cache.read("beta")?.fetchedAt, second.fetchedAt);
    assert.equal(cache.read("beta")?.outcomes[0]?.handle, "bearmacro");
    assert.notEqual(second.fetchedAt, first.fetchedAt);
  });
});
