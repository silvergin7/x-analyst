import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readDesearchMaxRequestsPerHandleStrict,
  readDesearchMaxRequestsPerRunStrict,
  validateLiveDesearchRequestLimits,
} from "../src/config/desearchSettings.js";

describe("live Desearch request limits", () => {
  it("rejects unset or malformed run and per-handle caps", () => {
    assert.equal(readDesearchMaxRequestsPerRunStrict({}).ok, false);
    assert.equal(
      readDesearchMaxRequestsPerRunStrict({ DESEARCH_MAX_REQUESTS_PER_RUN: "" }).ok,
      false,
    );
    assert.equal(
      readDesearchMaxRequestsPerRunStrict({ DESEARCH_MAX_REQUESTS_PER_RUN: "nope" }).ok,
      false,
    );
    assert.equal(readDesearchMaxRequestsPerHandleStrict({}).ok, false);
    assert.equal(
      readDesearchMaxRequestsPerHandleStrict({ DESEARCH_MAX_REQUESTS_PER_HANDLE: "0" }).ok,
      false,
    );
    const both = validateLiveDesearchRequestLimits({
      DESEARCH_MAX_REQUESTS_PER_RUN: "5",
      DESEARCH_MAX_REQUESTS_PER_HANDLE: "2",
    });
    assert.equal(both.ok, true);
  });
});
