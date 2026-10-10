import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planAnalysisInput } from "../src/analyze/analysisInput.js";
import { checkClassifications, parseModelOutlook } from "../src/analyze/classification.js";
import { LlmCitationError } from "../src/analyze/llmErrors.js";
import { buildSystemPrompt, buildUserPrompt } from "../src/analyze/llmPrompt.js";
import { BEYOND_INPUT_BUDGET_REASON } from "../src/analyze/analysisInput.js";
import { LLM_MAX_QUOTE_CONTEXT_CHARS } from "../src/config/llmSettings.js";
import type { Post } from "../src/types.js";
import { classifiedOutlook } from "./classifiedOutlook.js";

function post(overrides: Partial<Post> & Pick<Post, "id" | "kind" | "text">): Post {
  return {
    authorHandle: "analyst",
    timestamp: "2026-10-09T00:00:00.000Z",
    url: `https://fixture.x-analyst.local/posts/analyst/${overrides.id}`,
    ...overrides,
  };
}

const marketPosts = [
  post({
    id: "crypto-a",
    kind: "original",
    text: "Bitcoin still has room if liquidity stays easy.",
    timestamp: "2026-10-09T00:00:00.000Z",
  }),
  post({
    id: "crypto-b",
    kind: "original",
    text: "I would not chase the latest crypto spike.",
    timestamp: "2026-10-08T00:00:00.000Z",
  }),
  post({
    id: "rates-old",
    kind: "original",
    text: "Duration looked attractive last month.",
    timestamp: "2026-09-01T00:00:00.000Z",
  }),
  post({
    id: "noise",
    kind: "original",
    text: "Photos from a walk.",
    timestamp: "2026-10-10T00:00:00.000Z",
  }),
];

function checked(payload: ReturnType<typeof classifiedOutlook>) {
  const plan = planAnalysisInput(marketPosts, "analyst");
  return checkClassifications(plan.sent, parseModelOutlook(JSON.stringify(payload)), "2026-10-10");
}

describe("post classification", () => {
  it("accepts one classification for every sent id and counts relevant posts", () => {
    const result = checked(classifiedOutlook({
      outlook: "mixed",
      explanation: "Crypto is split and the rates comment is old.",
      posts: [
        { postId: "noise", relevant: false },
        { postId: "crypto-a", relevant: true, asset_class: "crypto", stance: "bullish" },
        { postId: "crypto-b", relevant: true, asset_class: "crypto", stance: "bearish" },
        { postId: "rates-old", relevant: true, asset_class: "rates_bonds", stance: "bullish" },
      ],
      assetOutlooks: [
        { asset_class: "crypto", outlook: "mixed", evidencePostIds: ["crypto-a"] },
        { asset_class: "rates_bonds", outlook: "cautious", evidencePostIds: ["rates-old"] },
      ],
    }));
    assert.equal(result.relevantPostCount, 3);
    assert.deepEqual(
      result.evidence.map((item) => item.postId),
      ["crypto-a", "crypto-b", "rates-old"],
    );
    assert.deepEqual(
      result.assetOutlooks.map((item) => item.assetClass),
      ["crypto", "rates_bonds"],
    );
    const crypto = result.assetOutlooks[0]!;
    const rates = result.assetOutlooks[1]!;
    assert.equal(crypto.outlook, "mixed");
    assert.deepEqual(crypto.evidence.map((item) => item.postId), ["crypto-a"]);
    assert.equal(crypto.viewMayBeStale, false);
    assert.equal(crypto.newestRelevantPostAt, "2026-10-09T00:00:00.000Z");
    assert.equal(rates.outlook, "cautious");
    assert.equal(rates.viewMayBeStale, true);
    assert.equal(rates.newestRelevantPostAt, "2026-09-01T00:00:00.000Z");
  });

  it("fails when a sent id is missing", () => {
    assert.throws(
      () =>
        checked(classifiedOutlook({
          outlook: "unclear",
          explanation: "One post was left out.",
          posts: [
            { postId: "noise", relevant: false },
            { postId: "crypto-a", relevant: false },
            { postId: "crypto-b", relevant: false },
          ],
        })),
      (err: unknown) =>
        err instanceof LlmCitationError &&
        /Classification missing sent id rates-old/.test(err.message),
    );
  });

  it("fails when a classification id was not sent", () => {
    assert.throws(
      () =>
        checked(classifiedOutlook({
          outlook: "unclear",
          explanation: "An unknown id was included.",
          posts: [
            { postId: "noise", relevant: false },
            { postId: "crypto-a", relevant: false },
            { postId: "crypto-b", relevant: false },
            { postId: "rates-old", relevant: false },
            { postId: "2104906619062538582", relevant: false },
          ],
        })),
      (err: unknown) =>
        err instanceof LlmCitationError &&
        /Citation id 2104906619062538582 was not in the model input/.test(err.message),
    );
  });
});

describe("quoted post context", () => {
  const commentary = "I still see room for duration to rally.";
  const quoted = `${"Q".repeat(LLM_MAX_QUOTE_CONTEXT_CHARS)}OVERFLOW`;

  function quotePost(): Post {
    return post({
      id: "quote-own",
      kind: "quote",
      text: "timeline text that is not the commentary",
      analystComment: commentary,
      quotedPostText: quoted,
      timestamp: "2026-10-09T00:00:00.000Z",
    });
  }

  it("labels quote.text as another account and counts the 500 character cap", () => {
    const plan = planAnalysisInput(
      [
        quotePost(),
        post({
          id: "next",
          kind: "original",
          text: "Later original that should not fit.",
          timestamp: "2026-10-08T00:00:00.000Z",
        }),
      ],
      "analyst",
      { inputMaxChars: commentary.length + LLM_MAX_QUOTE_CONTEXT_CHARS },
    );
    assert.deepEqual(plan.sent.map((item) => item.post.id), ["quote-own"]);
    assert.equal(plan.sent[0]?.quoteContext?.length, LLM_MAX_QUOTE_CONTEXT_CHARS);
    assert.equal(plan.sent[0]?.quoteContextTruncated, true);
    assert.equal(plan.sent[0]?.quoteContext?.includes("OVERFLOW"), false);
    assert.equal(
      plan.records.find((record) => record.postId === "next")?.reason,
      BEYOND_INPUT_BUDGET_REASON,
    );
    const prompt = [
      buildSystemPrompt("2026-10-10", "desearch"),
      buildUserPrompt("What is the outlook?", plan.sent),
    ].join("\n");
    assert.match(prompt, /Never attribute quoted text to the analyst/);
    assert.match(
      prompt,
      /quoted post: another account's post, context only, never the analyst's own words/,
    );
    assert.match(prompt, new RegExp(`Q{${LLM_MAX_QUOTE_CONTEXT_CHARS}}`));
    assert.equal(prompt.includes("OVERFLOW"), false);
  });

  it("excludes the whole quote when the capped context does not fit", () => {
    const plan = planAnalysisInput([quotePost()], "analyst", {
      inputMaxChars: commentary.length + LLM_MAX_QUOTE_CONTEXT_CHARS - 1,
    });
    assert.equal(plan.sent.length, 0);
    assert.equal(plan.records[0]?.reason, BEYOND_INPUT_BUDGET_REASON);
  });
});
