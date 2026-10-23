import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CHUTES_CHAT_COMPLETIONS_URL,
  loadChutesChatCompletionsUrl,
} from "../src/config/llmSettings.js";
import { loadDesearchApiBase } from "../src/config/desearchSettings.js";
import {
  DEFAULT_DESEARCH_API_BASE,
  buildTwitterUserPostsRequest,
} from "../src/fetch/desearch/buildRequest.js";

describe("provider URL overrides", () => {
  it("defaults Desearch and Chutes URLs when env vars are unset", () => {
    assert.equal(loadDesearchApiBase({}), DEFAULT_DESEARCH_API_BASE);
    assert.equal(loadChutesChatCompletionsUrl({}), DEFAULT_CHUTES_CHAT_COMPLETIONS_URL);
  });

  it("uses DESEARCH_API_BASE and CHUTES_CHAT_COMPLETIONS_URL overrides", () => {
    const desearch = "http://127.0.0.1:9";
    const chutes = "http://127.0.0.1:9/v1/chat/completions";
    assert.equal(loadDesearchApiBase({ DESEARCH_API_BASE: desearch }), desearch);
    assert.equal(
      loadChutesChatCompletionsUrl({ CHUTES_CHAT_COMPLETIONS_URL: chutes }),
      chutes,
    );
    const req = buildTwitterUserPostsRequest("a", "key", undefined, desearch);
    assert.equal(new URL(req.url).origin, "http://127.0.0.1:9");
  });
});
