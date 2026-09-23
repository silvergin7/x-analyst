import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MockOutlookAnalyzer,
  validateEvidenceIntegrity,
} from "../src/analyze/outlookAnalyzer.js";
import { MockPostsFetcher } from "../src/fetch/postsFetcher.js";
import type { PersonOutlookReport } from "../src/types.js";

describe("MockOutlookAnalyzer", () => {
  const analyzer = new MockOutlookAnalyzer();
  const fetcher = new MockPostsFetcher();
  const question = { text: "What is each analyst's current market outlook?" };
  const completeRetrieval = { retrievalComplete: true };

  it("returns bullish with evidence tied to retrieved posts", async () => {
    const posts = (
      await fetcher.fetchForHandles(["bullmacro"], {
        maxPostsPerPerson: 10,
        maxPostsTotal: 50,
      })
    )[0];
    assert.equal(posts?.status, "ok");
    if (posts?.status !== "ok") return;

    const report = await analyzer.analyzePerson(
      "bullmacro",
      posts.posts,
      question,
      completeRetrieval,
    );
    assert.equal(report.outlook, "bullish");
    assert.ok(report.evidence.length > 0);
    assert.deepEqual(validateEvidenceIntegrity(report, posts.posts), {
      valid: true,
    });
    for (const e of report.evidence) {
      assert.equal(e.url.includes("fixture.x-analyst.local"), true);
    }
  });

  it("returns bearish or cautious for bearmacro with valid evidence", async () => {
    const posts = (
      await fetcher.fetchForHandles(["bearmacro"], {
        maxPostsPerPerson: 10,
        maxPostsTotal: 50,
      })
    )[0];
    assert.equal(posts?.status, "ok");
    if (posts?.status !== "ok") return;

    const report = await analyzer.analyzePerson(
      "bearmacro",
      posts.posts,
      question,
      completeRetrieval,
    );
    assert.ok(report.outlook === "bearish" || report.outlook === "cautious");
    assert.deepEqual(validateEvidenceIntegrity(report, posts.posts), {
      valid: true,
    });
  });

  it("returns unclear when only reposts and non-actionable originals exist", async () => {
    const posts = (
      await fetcher.fetchForHandles(["unclearmacro"], {
        maxPostsPerPerson: 10,
        maxPostsTotal: 50,
      })
    )[0];
    assert.equal(posts?.status, "ok");
    if (posts?.status !== "ok") return;

    const report = await analyzer.analyzePerson(
      "unclearmacro",
      posts.posts,
      question,
      completeRetrieval,
    );
    assert.equal(report.outlook, "unclear");
    assert.equal(report.evidence.length, 0);
  });

  it("rejects evidence with mismatched author or metadata", async () => {
    const posts = (
      await fetcher.fetchForHandles(["bullmacro"], {
        maxPostsPerPerson: 10,
        maxPostsTotal: 50,
      })
    )[0];
    assert.equal(posts?.status, "ok");
    if (posts?.status !== "ok") return;

    const report = await analyzer.analyzePerson(
      "bullmacro",
      posts.posts,
      question,
      completeRetrieval,
    );
    const tampered: PersonOutlookReport = {
      ...report,
      evidence: report.evidence.map((e) => ({
        ...e,
        url: "https://fixture.x-analyst.local/posts/wrong/x",
      })),
    };
    const result = validateEvidenceIntegrity(tampered, posts.posts);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.some((e) => e.includes("url mismatch")));
    }

    const wrongAuthor: PersonOutlookReport = {
      ...report,
      handle: "bullmacro",
      evidence: [
        {
          postId: posts.posts[0]!.id,
          url: posts.posts[0]!.url,
          timestamp: posts.posts[0]!.timestamp,
          kind: posts.posts[0]!.kind,
        },
      ],
    };
    const postsWrongOwner = posts.posts.map((p) => ({
      ...p,
      authorHandle: "othermacro",
    }));
    const authorResult = validateEvidenceIntegrity(wrongAuthor, postsWrongOwner);
    assert.equal(authorResult.valid, false);
    if (!authorResult.valid) {
      assert.ok(
        authorResult.errors.some((e) => e.includes("does not match report handle")),
      );
    }
  });
});
