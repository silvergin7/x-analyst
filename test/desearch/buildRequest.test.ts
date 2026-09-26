import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTwitterUserPostsRequest,
  TWITTER_USER_POSTS_PATH,
} from "../../src/fetch/desearch/buildRequest.js";

describe("buildTwitterUserPostsRequest", () => {
  it("builds documented path with username and raw Authorization", () => {
    const req = buildTwitterUserPostsRequest("bullmacro", "secret-key-value");
    assert.equal(req.method, "GET");
    const u = new URL(req.url);
    assert.equal(u.pathname, TWITTER_USER_POSTS_PATH);
    assert.equal(u.searchParams.get("username"), "bullmacro");
    assert.equal(u.searchParams.has("limit"), false);
    assert.equal(req.headers.Authorization, "secret-key-value");
    assert.doesNotMatch(req.headers.Authorization ?? "", /^Bearer /);
  });

  it("does not embed key material in the URL", () => {
    const req = buildTwitterUserPostsRequest("a", "my-secret");
    assert.doesNotMatch(req.url, /my-secret/);
  });

  it("includes cursor when paginating", () => {
    const req = buildTwitterUserPostsRequest("a", "key", "cursor-abc");
    assert.equal(new URL(req.url).searchParams.get("cursor"), "cursor-abc");
    assert.doesNotMatch(req.url, /key/);
  });
});
