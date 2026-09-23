import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDesearchPostsRequest } from "../../src/fetch/desearch/buildRequest.js";

describe("buildDesearchPostsRequest", () => {
  it("builds per-handle request with limit and auth header", () => {
    const req = buildDesearchPostsRequest("bullmacro", 5, "secret-key-value");
    assert.equal(req.method, "GET");
    assert.match(req.url, /handle=bullmacro/);
    assert.match(req.url, /limit=5/);
    assert.equal(req.headers.Authorization, "Bearer secret-key-value");
  });

  it("does not embed key material in the URL", () => {
    const req = buildDesearchPostsRequest("a", 1, "my-secret");
    assert.doesNotMatch(req.url, /my-secret/);
  });

  it("includes cursor when paginating", () => {
    const req = buildDesearchPostsRequest("a", 2, "key", "cursor-abc");
    assert.match(req.url, /cursor=cursor-abc/);
    assert.doesNotMatch(req.url, /key/);
  });
});
