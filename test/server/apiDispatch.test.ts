import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildMetaResponse,
  dispatchApiForTest,
} from "../../server/apiDispatch.js";

describe("GET /api/meta", () => {
  it("returns viewer metadata without live API access", async () => {
    const { statusCode, body } = await dispatchApiForTest({
      method: "GET",
      pathname: "/api/meta",
    });
    assert.equal(statusCode, 200);
    const json = JSON.parse(body) as ReturnType<typeof buildMetaResponse>;
    assert.equal(json.mode, "viewer");
    assert.equal(json.liveApiEnabled, false);
  });
});

describe("GET /api/reports", () => {
  it("rejects unsafe report ids", async () => {
    const traversal = await dispatchApiForTest({
      method: "GET",
      pathname: "/api/reports/..%2F.env.json",
    });
    assert.equal(traversal.statusCode, 400);

    const slash = await dispatchApiForTest({
      method: "GET",
      pathname: "/api/reports/nope/not.json",
    });
    assert.equal(slash.statusCode, 400);
  });
});

describe("POST /api/analyze", () => {
  it("is disabled in the web viewer", async () => {
    const { statusCode, body } = await dispatchApiForTest({
      method: "POST",
      pathname: "/api/analyze",
      body: JSON.stringify({ handles: "bullmacro", question: "Outlook?" }),
    });
    assert.equal(statusCode, 405);
    assert.match(body, /npm run analyze/);
  });
});
