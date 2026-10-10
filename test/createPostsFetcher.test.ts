import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createCliPostsFetcher,
  createPostsFetcherFromEnv,
} from "../src/fetch/createPostsFetcher.js";
import {
  DesearchNotConfiguredError,
  DesearchPostsFetcher,
} from "../src/fetch/desearch/desearchPostsFetcher.js";
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
  let savedLive: string | undefined;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.POSTS_PROVIDER;
    savedLive = process.env.DESEARCH_LIVE_ENABLED;
    savedKey = process.env.DESEARCH_API_KEY;
  });

  afterEach(() => {
    if (savedProvider === undefined) delete process.env.POSTS_PROVIDER;
    else process.env.POSTS_PROVIDER = savedProvider;
    if (savedLive === undefined) delete process.env.DESEARCH_LIVE_ENABLED;
    else process.env.DESEARCH_LIVE_ENABLED = savedLive;
    if (savedKey === undefined) delete process.env.DESEARCH_API_KEY;
    else process.env.DESEARCH_API_KEY = savedKey;
  });

  it("returns mock when provider is mock", () => {
    process.env.POSTS_PROVIDER = "mock";
    assert.ok(createPostsFetcherFromEnv() instanceof MockPostsFetcher);
  });

  it("returns mock when desearch is not live-eligible", () => {
    process.env.POSTS_PROVIDER = "desearch";
    process.env.DESEARCH_LIVE_ENABLED = "false";
    process.env.DESEARCH_API_KEY = "unit-test-only-not-a-secret";
    assert.ok(createPostsFetcherFromEnv() instanceof MockPostsFetcher);
  });

  it("returns DesearchPostsFetcher with injected transport when live-eligible", () => {
    process.env.POSTS_PROVIDER = "desearch";
    process.env.DESEARCH_LIVE_ENABLED = "true";
    process.env.DESEARCH_API_KEY = "unit-test-only-not-a-secret";
    const fetcher = createPostsFetcherFromEnv({
      transport: { execute: async () => ({ status: 200, body: {} }) },
    });
    assert.ok(fetcher instanceof DesearchPostsFetcher);
  });

  it("throws for an explicit incomplete Desearch selection without calling transport", () => {
    let calls = 0;
    assert.throws(
      () =>
        createPostsFetcherFromEnv({
          env: { POSTS_PROVIDER: "desearch" },
          ineligibleDesearch: "throw",
          transport: {
            async execute() {
              calls += 1;
              return { status: 200, body: {} };
            },
          },
        }),
      DesearchNotConfiguredError,
    );
    assert.equal(calls, 0);
  });

  it("builds the eligible fetcher from the passed env and transport", async () => {
    process.env.DESEARCH_API_KEY = "process-env-key";
    let authorization = "";
    const fetcher = createPostsFetcherFromEnv({
      env: {
        POSTS_PROVIDER: "desearch",
        DESEARCH_LIVE_ENABLED: "true",
        DESEARCH_API_KEY: "env-arg-key",
        DESEARCH_MAX_REQUESTS_PER_RUN: "1",
      },
      transport: {
        async execute(request) {
          authorization = request.headers.Authorization ?? "";
          return { status: 200, body: { tweets: [] } };
        },
      },
    });
    assert.ok(fetcher instanceof DesearchPostsFetcher);
    await fetcher.fetchForHandles(["bullmacro"], {
      maxPostsPerPerson: 1,
      maxPostsTotal: 1,
    });
    assert.equal(authorization, "env-arg-key");
  });

  it("uses default HTTPS transport factory when live-eligible and no override", () => {
    process.env.POSTS_PROVIDER = "desearch";
    process.env.DESEARCH_LIVE_ENABLED = "true";
    process.env.DESEARCH_API_KEY = "unit-test-only-not-a-secret";
    const fetcher = createPostsFetcherFromEnv();
    assert.ok(fetcher instanceof DesearchPostsFetcher);
  });
});
