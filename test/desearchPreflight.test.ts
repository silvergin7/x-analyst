import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTwitterUserPostsRequest } from "../src/fetch/desearch/buildRequest.js";
import {
  DESEARCH_OBSERVED_MAX_POSTS_PER_RESPONSE,
  describeDesearchCountOnWire,
  desearchWorstCasePostsPerRequest,
} from "../src/runtime/desearchPreflight.js";

describe("desearch preflight", () => {
  it("reports that count is not sent on the current request builder", () => {
    const request = buildTwitterUserPostsRequest("analyst", "key");
    assert.match(describeDesearchCountOnWire(request), /not sent/);
    assert.equal(desearchWorstCasePostsPerRequest(request).postsPerRequest, DESEARCH_OBSERVED_MAX_POSTS_PER_RESPONSE);
  });
});
