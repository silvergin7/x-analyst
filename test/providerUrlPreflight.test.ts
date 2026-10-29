import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAnalyzePreflightLines } from "../src/analyzePreflight.js";
import { DEFAULT_CHUTES_CHAT_COMPLETIONS_URL } from "../src/config/llmSettings.js";
import { DEFAULT_DESEARCH_API_BASE } from "../src/fetch/desearch/buildRequest.js";
import {
  isNonDefaultProviderOrigin,
  parseProviderOverrideUrl,
  providerEndpointOrigin,
  providerHostPreflightLines,
  providerOverrideWarningLines,
  resolvedChutesOverrideUrl,
  resolvedDesearchOverrideUrl,
  validateProviderOverrides,
} from "../src/runtime/providerUrlPreflight.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";
import { withTestChutesModelEnv } from "./support/chutesTestModel.js";
import { testChutesModelPlan } from "./support/testChutesModelPlan.js";

describe("provider URL preflight", () => {
  it("formats provider origins without path or query", () => {
    assert.equal(
      providerEndpointOrigin(new URL("https://llm.chutes.ai/v1/chat/completions")),
      "https://llm.chutes.ai",
    );
    assert.equal(
      providerEndpointOrigin(new URL("http://127.0.0.1:9/twitter/user/posts")),
      "http://127.0.0.1:9",
    );
    assert.equal(providerEndpointOrigin(new URL(DEFAULT_DESEARCH_API_BASE)), "https://api.desearch.ai");
  });

  it("rejects credentials, query strings, and fragments in overrides", () => {
    assert.throws(
      () => parseProviderOverrideUrl("https://key:secret@api.example", "DESEARCH_API_BASE"),
      (err: Error) => err.message.includes("DESEARCH_API_BASE is invalid"),
    );
    assert.throws(
      () => parseProviderOverrideUrl("https://api.example?x=1", "CHUTES_CHAT_COMPLETIONS_URL"),
      (err: Error) => err.message.includes("CHUTES_CHAT_COMPLETIONS_URL is invalid"),
    );
    assert.throws(
      () => parseProviderOverrideUrl("https://api.example#frag", "DESEARCH_API_BASE"),
      (err: Error) => err.message.includes("DESEARCH_API_BASE is invalid"),
    );
  });

  it("treats default Chutes path as the default origin", () => {
    const resolved = resolvedChutesOverrideUrl({
      CHUTES_CHAT_COMPLETIONS_URL: "https://llm.chutes.ai/v1/chat/completions/",
    });
    assert.equal(isNonDefaultProviderOrigin(resolved, DEFAULT_CHUTES_CHAT_COMPLETIONS_URL), false);
    assert.equal(providerOverrideWarningLines({}, { offline: false, replay: false }).length, 0);
  });

  it("warns when origins differ from defaults", () => {
    const env = {
      DESEARCH_API_BASE: "http://127.0.0.1:9",
      CHUTES_CHAT_COMPLETIONS_URL: "http://127.0.0.1:9/v1/chat/completions",
    };
    const warnings = providerOverrideWarningLines(env, { offline: false, replay: false });
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /http:\/\/127\.0\.0\.1:9/);
    assert.doesNotMatch(warnings[0]!, /\/twitter/);
    assert.doesNotMatch(warnings[1]!, /\/v1\/chat/);
  });

  it("prints host lines as origins only", () => {
    const env = {
      CHUTES_CHAT_COMPLETIONS_URL: "http://127.0.0.1:9/v1/chat/completions",
    };
    const hosts = providerHostPreflightLines(env, { offline: false, replay: false });
    assert.deepEqual(hosts, [
      "Desearch host: https://api.desearch.ai",
      "Chutes host: http://127.0.0.1:9",
    ]);
  });

  it("skips Desearch host and warnings on replay", () => {
    const env = {
      DESEARCH_API_BASE: "http://127.0.0.1:9",
      CHUTES_CHAT_COMPLETIONS_URL: "http://127.0.0.1:9/v1/chat/completions",
    };
    assert.equal(
      providerOverrideWarningLines(env, { offline: false, replay: true }).length,
      1,
    );
    assert.deepEqual(providerHostPreflightLines(env, { offline: false, replay: true }), [
      "Chutes host: http://127.0.0.1:9",
    ]);
  });

  it("blocks http overrides to non-loopback hosts", () => {
    const result = validateProviderOverrides(
      { DESEARCH_API_BASE: "http://evil.example" },
      { offline: false, replay: false },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /DESEARCH_API_BASE must use https/);
      assert.doesNotMatch(result.message, /evil/);
    }
  });

  it("allows http loopback overrides", () => {
    const result = validateProviderOverrides(
      {
        DESEARCH_API_BASE: "http://127.0.0.1:9",
        CHUTES_CHAT_COMPLETIONS_URL: "http://127.0.0.1:9/v1/chat/completions",
      },
      { offline: false, replay: false },
    );
    assert.equal(result.ok, true);
  });

  it("does not treat localhost.evil.com as loopback for http", () => {
    const result = validateProviderOverrides(
      { CHUTES_CHAT_COMPLETIONS_URL: "http://localhost.evil.com/v1/chat/completions" },
      { offline: false, replay: true },
    );
    assert.equal(result.ok, false);
  });

  it("includes override warnings in live preflight output", () => {
    installByteQuarterMockTokenizer();
    try {
      const lines = buildAnalyzePreflightLines({
        handles: ["bullmacro"],
        question: "Q",
        referenceDate: "2026-10-10",
        replay: false,
        offline: false,
        chutesModelPlan: testChutesModelPlan(),
        env: withTestChutesModelEnv({
          DESEARCH_MAX_REQUESTS_PER_RUN: "5",
          DESEARCH_MAX_REQUESTS_PER_HANDLE: "3",
          DESEARCH_API_BASE: "http://127.0.0.1:9",
        }),
      });
      assert.match(lines[0]!, /Warning: DESEARCH_API_BASE is not the default/);
    } finally {
      clearMockTokenizer();
    }
  });

  it("host line must not include request path", () => {
    installByteQuarterMockTokenizer();
    try {
      const lines = buildAnalyzePreflightLines({
        handles: ["bullmacro"],
        question: "Q",
        referenceDate: "2026-10-10",
        replay: false,
        offline: false,
        chutesModelPlan: testChutesModelPlan(),
        env: withTestChutesModelEnv({
          DESEARCH_MAX_REQUESTS_PER_RUN: "5",
          DESEARCH_MAX_REQUESTS_PER_HANDLE: "3",
          CHUTES_CHAT_COMPLETIONS_URL: "http://127.0.0.1:9/v1/chat/completions",
        }),
      });
      const chutesHost = lines.find((line) => line.startsWith("Chutes host:"));
      assert.equal(chutesHost, "Chutes host: http://127.0.0.1:9");
      assert.ok(!lines.some((line) => line.includes("/v1/chat/completions")));
    } finally {
      clearMockTokenizer();
    }
  });

});
