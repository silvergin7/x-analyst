import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadFetchLimits } from "../src/config.js";

const ENV_KEYS = ["MAX_POSTS_PER_PERSON", "MAX_POSTS_TOTAL"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function saveEnv(): void {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
}

describe("loadFetchLimits", () => {
  beforeEach(() => {
    saveEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("uses documented defaults when env vars are absent", () => {
    delete process.env.MAX_POSTS_PER_PERSON;
    delete process.env.MAX_POSTS_TOTAL;
    assert.deepEqual(loadFetchLimits(), {
      maxPostsPerPerson: 10,
      maxPostsTotal: 25,
    });
  });

  it("accepts positive whole integers", () => {
    process.env.MAX_POSTS_PER_PERSON = "5";
    process.env.MAX_POSTS_TOTAL = "12";
    assert.deepEqual(loadFetchLimits(), {
      maxPostsPerPerson: 5,
      maxPostsTotal: 12,
    });
  });

  it("falls back for blank, zero, negative, decimal, and malformed values", () => {
    process.env.MAX_POSTS_PER_PERSON = "   ";
    process.env.MAX_POSTS_TOTAL = "0";
    assert.deepEqual(loadFetchLimits(), {
      maxPostsPerPerson: 10,
      maxPostsTotal: 25,
    });

    process.env.MAX_POSTS_PER_PERSON = "-1";
    process.env.MAX_POSTS_TOTAL = "1.5";
    assert.deepEqual(loadFetchLimits(), {
      maxPostsPerPerson: 10,
      maxPostsTotal: 25,
    });

    process.env.MAX_POSTS_PER_PERSON = "5abc";
    process.env.MAX_POSTS_TOTAL = "not-a-number";
    assert.deepEqual(loadFetchLimits(), {
      maxPostsPerPerson: 10,
      maxPostsTotal: 25,
    });
  });

  it("falls back when digits-only values exceed safe integer range", () => {
    const huge = "999999999999999999999999999999999999999";
    process.env.MAX_POSTS_PER_PERSON = huge;
    process.env.MAX_POSTS_TOTAL = huge;
    assert.deepEqual(loadFetchLimits(), {
      maxPostsPerPerson: 10,
      maxPostsTotal: 25,
    });
  });
});
