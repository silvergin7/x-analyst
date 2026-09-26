import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DESEARCH_PLACEHOLDER_KEY,
  loadDesearchRequestBudget,
  loadDesearchSettings,
  resolveDesearchApiKey,
  resolveMaxRequestsPerRunOverride,
} from "../src/config/desearchSettings.js";

const KEYS = [
  "POSTS_PROVIDER",
  "DESEARCH_API_KEY",
  "DESEARCH_LIVE_ENABLED",
] as const;

const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
const FAKE_KEY = "unit-test-only-not-a-secret";

function saveEnv(): void {
  for (const k of KEYS) saved[k] = process.env[k];
}

function restoreEnv(): void {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe("loadDesearchSettings", () => {
  beforeEach(() => saveEnv());
  afterEach(() => restoreEnv());

  it("does not enable live mode without explicit configuration", () => {
    delete process.env.POSTS_PROVIDER;
    delete process.env.DESEARCH_API_KEY;
    delete process.env.DESEARCH_LIVE_ENABLED;
    const s = loadDesearchSettings();
    assert.equal(s.liveEligible, false);
    assert.equal(s.hasUsableCredential, false);
  });

  it("rejects placeholder API key for eligibility", () => {
    process.env.POSTS_PROVIDER = "desearch";
    process.env.DESEARCH_LIVE_ENABLED = "true";
    process.env.DESEARCH_API_KEY = DESEARCH_PLACEHOLDER_KEY;
    const s = loadDesearchSettings();
    assert.equal(s.hasUsableCredential, false);
    assert.equal(s.liveEligible, false);
  });

  it("allows liveEligible only with provider, flag, and usable credential", () => {
    process.env.POSTS_PROVIDER = "desearch";
    process.env.DESEARCH_LIVE_ENABLED = "true";
    process.env.DESEARCH_API_KEY = FAKE_KEY;
    const s = loadDesearchSettings();
    assert.equal(s.liveEligible, true);
    assert.equal(s.hasUsableCredential, true);
    assert.equal("apiKey" in s, false);
  });
});

describe("loadDesearchRequestBudget", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.DESEARCH_MAX_REQUESTS_PER_RUN;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DESEARCH_MAX_REQUESTS_PER_RUN;
    else process.env.DESEARCH_MAX_REQUESTS_PER_RUN = saved;
  });

  it("defaults to a conservative positive integer", () => {
    delete process.env.DESEARCH_MAX_REQUESTS_PER_RUN;
    assert.equal(loadDesearchRequestBudget(), 5);
  });

  it("accepts positive whole integers", () => {
    process.env.DESEARCH_MAX_REQUESTS_PER_RUN = "3";
    assert.equal(loadDesearchRequestBudget(), 3);
  });
});

describe("resolveMaxRequestsPerRunOverride", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.DESEARCH_MAX_REQUESTS_PER_RUN;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DESEARCH_MAX_REQUESTS_PER_RUN;
    else process.env.DESEARCH_MAX_REQUESTS_PER_RUN = saved;
  });

  it("falls back to configured env budget for invalid overrides", () => {
    process.env.DESEARCH_MAX_REQUESTS_PER_RUN = "1";
    assert.equal(resolveMaxRequestsPerRunOverride(-3), 1);
    assert.equal(resolveMaxRequestsPerRunOverride(0), 1);
    assert.equal(resolveMaxRequestsPerRunOverride(1.5), 1);
  });

  it("falls back to default when env unset and override invalid", () => {
    delete process.env.DESEARCH_MAX_REQUESTS_PER_RUN;
    assert.equal(resolveMaxRequestsPerRunOverride(-1), 5);
  });

  it("accepts positive safe integers", () => {
    assert.equal(resolveMaxRequestsPerRunOverride(2), 2);
  });
});

describe("resolveDesearchApiKey", () => {
  beforeEach(() => saveEnv());
  afterEach(() => restoreEnv());

  it("returns undefined for placeholder without exposing it in settings", () => {
    process.env.DESEARCH_API_KEY = DESEARCH_PLACEHOLDER_KEY;
    assert.equal(resolveDesearchApiKey(), undefined);
  });

  it("resolves a non-empty credential at boundary when env is usable", () => {
    process.env.DESEARCH_API_KEY = FAKE_KEY;
    const key = resolveDesearchApiKey();
    assert.ok(key && key.length > 0);
  });
});
