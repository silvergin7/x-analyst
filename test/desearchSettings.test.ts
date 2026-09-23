import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DESEARCH_PLACEHOLDER_KEY,
  loadDesearchSettings,
  resolveDesearchApiKey,
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
