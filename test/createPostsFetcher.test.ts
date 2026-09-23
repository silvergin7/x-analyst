import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createCliPostsFetcher,
  createPostsFetcherFromEnv,
} from "../src/fetch/createPostsFetcher.js";
import { DesearchNotConfiguredError } from "../src/fetch/desearch/desearchPostsFetcher.js";
import { MockPostsFetcher } from "../src/fetch/postsFetcher.js";

describe("createCliPostsFetcher", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.POSTS_PROVIDER;
    process.env.POSTS_PROVIDER = "desearch";
    process.env.DESEARCH_LIVE_ENABLED = "true";
    process.env.DESEARCH_API_KEY = "unit-test-only-not-a-secret";
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.POSTS_PROVIDER;
    else process.env.POSTS_PROVIDER = saved;
    delete process.env.DESEARCH_LIVE_ENABLED;
    delete process.env.DESEARCH_API_KEY;
  });

  it("returns mock fetcher even when env selects desearch", () => {
    assert.ok(createCliPostsFetcher() instanceof MockPostsFetcher);
  });
});

describe("createPostsFetcherFromEnv", () => {
  let savedProvider: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.POSTS_PROVIDER;
  });

  afterEach(() => {
    if (savedProvider === undefined) delete process.env.POSTS_PROVIDER;
    else process.env.POSTS_PROVIDER = savedProvider;
    delete process.env.DESEARCH_LIVE_ENABLED;
    delete process.env.DESEARCH_API_KEY;
  });

  it("returns mock when provider is mock", () => {
    process.env.POSTS_PROVIDER = "mock";
    assert.ok(createPostsFetcherFromEnv() instanceof MockPostsFetcher);
  });

  it("fails closed for desearch without injected transport", () => {
    process.env.POSTS_PROVIDER = "desearch";
    process.env.DESEARCH_LIVE_ENABLED = "true";
    process.env.DESEARCH_API_KEY = "unit-test-only-not-a-secret";
    assert.throws(
      () => createPostsFetcherFromEnv(),
      DesearchNotConfiguredError,
    );
  });
});
