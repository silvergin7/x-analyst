import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  SavedSliceError,
  loadSlice,
  outcomesForSlice,
  saveSlice,
} from "../src/runtime/savedSlice.js";
import type { FetchOutcome } from "../src/types.js";

const commit = "c".repeat(40);

function outcome(): FetchOutcome {
  return {
    status: "ok",
    handle: "bullmacro",
    retrievalComplete: true,
    posts: [
      {
        id: "p1",
        authorHandle: "bullmacro",
        text: "Growth remains constructive.",
        timestamp: "2026-09-20T14:00:00.000Z",
        url: "https://fixture.x-analyst.local/status/p1",
        kind: "original",
      },
    ],
    billing: [{ usageCount: 2, costUsd: 0.01 }],
  };
}

describe("saved slices", () => {
  it("stores posts without billing and reads them back", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-slice-"));
    const file = saveSlice(dir, {
      version: 1,
      fetchedAt: "2026-11-02T12:00:00.000Z",
      fetchedCommit: commit,
      referenceDate: "2026-11-02",
      handles: ["bullmacro"],
      postsSource: "desearch",
      outcomes: outcomesForSlice([outcome()]),
    });
    const loaded = loadSlice(file);
    assert.equal(loaded.fetchedCommit, commit);
    assert.equal(loaded.fetchedAt, "2026-11-02T12:00:00.000Z");
    assert.equal(loaded.outcomes[0]?.status, "ok");
    if (loaded.outcomes[0]?.status === "ok") {
      assert.equal(loaded.outcomes[0].posts[0]?.id, "p1");
      assert.equal(loaded.outcomes[0].billing, undefined);
    }
  });

  it("rejects a slice that carries a request field", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-slice-"));
    const dirty = outcome() as FetchOutcome & { authorization?: string };
    dirty.authorization = "must-not-store";
    assert.throws(
      () =>
        saveSlice(dir, {
          version: 1,
          fetchedAt: "2026-11-02T12:00:00.000Z",
          fetchedCommit: commit,
          referenceDate: "2026-11-02",
          handles: ["bullmacro"],
          postsSource: "fixtures",
          outcomes: [dirty],
        }),
      (err: unknown) => err instanceof SavedSliceError,
    );
  });

  it("rejects a slice whose version is not supported", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "x-analyst-slice-"));
    const file = saveSlice(dir, {
      version: 1,
      fetchedAt: "2026-11-02T12:00:00.000Z",
      fetchedCommit: commit,
      referenceDate: "2026-11-02",
      handles: ["bullmacro"],
      postsSource: "fixtures",
      outcomes: outcomesForSlice([outcome()]),
    });
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { version: number };
    parsed.version = 2;
    writeFileSync(file, JSON.stringify(parsed));
    assert.throws(() => loadSlice(file), (err: unknown) => err instanceof SavedSliceError);
  });
});
