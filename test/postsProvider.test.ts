import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  cliPostsProvider,
  loadPostsProviderConfig,
} from "../src/config/postsProvider.js";

describe("loadPostsProviderConfig", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.POSTS_PROVIDER;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.POSTS_PROVIDER;
    else process.env.POSTS_PROVIDER = saved;
  });

  it("defaults to mock when unset", () => {
    delete process.env.POSTS_PROVIDER;
    assert.deepEqual(loadPostsProviderConfig(), { provider: "mock" });
  });

  it("accepts mock and desearch", () => {
    process.env.POSTS_PROVIDER = "desearch";
    assert.deepEqual(loadPostsProviderConfig(), { provider: "desearch" });
    process.env.POSTS_PROVIDER = "mock";
    assert.deepEqual(loadPostsProviderConfig(), { provider: "mock" });
  });

  it("falls back to mock for invalid provider names", () => {
    process.env.POSTS_PROVIDER = "twitter";
    assert.deepEqual(loadPostsProviderConfig(), { provider: "mock" });
  });
});

describe("cliPostsProvider", () => {
  it("always returns mock for CLI path", () => {
    process.env.POSTS_PROVIDER = "desearch";
    assert.equal(cliPostsProvider(), "mock");
  });
});
