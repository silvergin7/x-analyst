import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planAnalysisInput } from "../src/analyze/analysisInput.js";
import {
  checkClassifications,
  parseModelOutlook,
  resolveAliasClassifications,
} from "../src/analyze/classification.js";
import { postAliases } from "../src/analyze/postAliases.js";
import { LlmCitationError, LlmOutputError } from "../src/analyze/llmErrors.js";
import { CLASSIFICATION_REASON_MAX_CHARS } from "../src/analyze/outputBudget.js";
import { buildSystemPrompt, buildUserPrompt } from "../src/analyze/llmPrompt.js";
import { BEYOND_INPUT_BUDGET_REASON } from "../src/analyze/analysisInput.js";
import { LLM_MAX_QUOTE_CONTEXT_CHARS } from "../src/config/llmSettings.js";
import type { Post } from "../src/types.js";
import { aliasModel, classifiedOutlook } from "./classifiedOutlook.js";

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
  const aliases = postAliases(plan.sent);
  const parsed = parseModelOutlook(
    JSON.stringify(aliasModel(plan.sent, payload)),
    aliases.map((item) => item.alias),
  );
  return checkClassifications(
    plan.sent,
    resolveAliasClassifications(aliases, parsed),
    "2026-10-10",
  );
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
        /Unclassified posts were 1 of 4, above the 10% limit/.test(err.message),
    );
  });

  it("rejects a reason longer than 120 characters and still accepts 120", () => {
    const reason = "x".repeat(CLASSIFICATION_REASON_MAX_CHARS);
    const accepted = classifiedOutlook({
      outlook: "unclear",
      explanation: "No market stance in these posts.",
      posts: [
        { postId: "noise", relevant: false, reason },
        { postId: "crypto-a", relevant: false, reason },
        { postId: "crypto-b", relevant: false, reason },
        { postId: "rates-old", relevant: false, reason },
      ],
    });
    const plan = planAnalysisInput(marketPosts, "analyst");
    const aliases = postAliases(plan.sent);
    const aliasNames = aliases.map((item) => item.alias);
    const acceptedModel = aliasModel(plan.sent, accepted);
    assert.equal(reason.length, 120);
    assert.doesNotThrow(() =>
      checkClassifications(
        plan.sent,
        resolveAliasClassifications(
          aliases,
          parseModelOutlook(JSON.stringify(acceptedModel), aliasNames),
        ),
        "2026-10-10",
      ),
    );
    acceptedModel.posts[aliases[0]!.alias]!.reason = "x".repeat(CLASSIFICATION_REASON_MAX_CHARS + 1);
    assert.throws(
      () => parseModelOutlook(JSON.stringify(acceptedModel), aliasNames),
      (err: unknown) =>
        err instanceof LlmOutputError && /reason exceeded the character bound/.test(err.message),
    );
    const tooManyWords = aliasModel(plan.sent, classifiedOutlook({
      outlook: "unclear",
      explanation: "Too many words in one reason.",
      posts: [
        { postId: "noise", relevant: false, reason: "word ".repeat(21).trim() },
        { postId: "crypto-a", relevant: false },
        { postId: "crypto-b", relevant: false },
        { postId: "rates-old", relevant: false },
      ],
    }));
    const longReason = tooManyWords.posts[aliases[0]!.alias]!.reason;
    assert.ok(longReason.length <= CLASSIFICATION_REASON_MAX_CHARS);
    assert.throws(
      () => parseModelOutlook(JSON.stringify(tooManyWords), aliasNames),
      (err: unknown) => err instanceof LlmOutputError && /exceeded 20 words/.test(err.message),
    );
  });

  it("fails when a post id is cited in two asset outlooks", () => {
    assert.throws(
      () =>
        checked(classifiedOutlook({
          outlook: "mixed",
          explanation: "The same post was cited twice.",
          posts: [
            { postId: "noise", relevant: false },
            { postId: "crypto-a", relevant: true, asset_class: "crypto", stance: "bullish" },
            { postId: "crypto-b", relevant: true, asset_class: "crypto", stance: "bearish" },
            { postId: "rates-old", relevant: true, asset_class: "rates_bonds", stance: "bullish" },
          ],
          assetOutlooks: [
            { asset_class: "crypto", outlook: "mixed", evidencePostIds: ["crypto-a"] },
            {
              asset_class: "rates_bonds",
              outlook: "cautious",
              evidencePostIds: ["crypto-a", "rates-old"],
            },
          ],
        })),
      (err: unknown) =>
        err instanceof LlmCitationError &&
        /Post id crypto-a was cited in more than one asset outlook/.test(err.message),
    );
  });

  it("fails when a post id is cited in the wrong asset class", () => {
    assert.throws(
      () =>
        checked(classifiedOutlook({
          outlook: "mixed",
          explanation: "A crypto post was cited as rates.",
          posts: [
            { postId: "noise", relevant: false },
            { postId: "crypto-a", relevant: true, asset_class: "crypto", stance: "bullish" },
            { postId: "crypto-b", relevant: true, asset_class: "crypto", stance: "bearish" },
            { postId: "rates-old", relevant: true, asset_class: "rates_bonds", stance: "bullish" },
          ],
          assetOutlooks: [
            { asset_class: "crypto", outlook: "mixed", evidencePostIds: ["crypto-b"] },
            {
              asset_class: "rates_bonds",
              outlook: "cautious",
              evidencePostIds: ["crypto-a", "rates-old"],
            },
          ],
        })),
      (err: unknown) =>
        err instanceof LlmCitationError &&
        /Asset class rates_bonds cited crypto-a, which is not a relevant post of that class/.test(
          err.message,
        ),
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
        /Unknown alias 2104906619062538582/.test(err.message),
    );
  });

  it("rejects an unknown alias from parseModelOutlook alone", () => {
    const content = JSON.stringify({
      outlook: "unclear",
      explanation: "An extra alias was included.",
      posts: {
        missing: {
          relevant: false,
          asset_class: "none",
          stance: "unclear",
          reason: "Not about markets.",
        },
      },
      assetOutlooks: [],
    });
    assert.throws(
      () => parseModelOutlook(content, ["p1"]),
      (err: unknown) => err instanceof LlmCitationError && err.message === "Unknown alias missing",
    );
  });

  it("rejects an unknown alias from resolveAliasClassifications alone", () => {
    const plan = planAnalysisInput([marketPosts[0]], "analyst");
    const aliases = postAliases(plan.sent);
    assert.equal(aliases[0]?.alias, "p1");
    assert.throws(
      () =>
        resolveAliasClassifications(aliases, {
          outlook: "unclear",
          explanation: "An extra alias was included.",
          posts: [
            {
              postId: "missing",
              relevant: false,
              assetClass: "none",
              stance: "unclear",
              reason: "Not about markets.",
            },
          ],
          assetOutlooks: [],
        }),
      (err: unknown) => err instanceof LlmCitationError && err.message === "Unknown alias missing",
    );
  });

  it("allows one unclassified post in ten and fails two", () => {
    const posts = Array.from({ length: 10 }, (_, index) =>
      post({
        id: `n${index + 1}`,
        kind: "original",
        text: "No market view here.",
        timestamp: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const plan = planAnalysisInput(posts, "analyst");
    const aliases = postAliases(plan.sent);
    const names = aliases.map((item) => item.alias);
    const oneMissing = Object.fromEntries(
      aliases.slice(1).map((item) => [
        item.alias,
        {
          relevant: false,
          asset_class: "none",
          stance: "unclear",
          reason: "Not about markets.",
        },
      ]),
    );
    const allowed = resolveAliasClassifications(
      aliases,
      parseModelOutlook(
        JSON.stringify({
          outlook: "unclear",
          explanation: "No market stance in these posts.",
          posts: oneMissing,
          assetOutlooks: [],
        }),
        names,
      ),
    );
    const missing = allowed.posts.find((item) => item.reason === "unclassified_by_model");
    assert.equal(missing?.postId, aliases[0]?.post.post.id);
    assert.equal(allowed.posts.length, 10);
    const twoMissing = { ...oneMissing };
    delete twoMissing[aliases[1]!.alias];
    assert.throws(
      () =>
        resolveAliasClassifications(
          aliases,
          parseModelOutlook(
            JSON.stringify({
              outlook: "unclear",
              explanation: "No market stance in these posts.",
              posts: twoMissing,
              assetOutlooks: [],
            }),
            names,
          ),
        ),
      (err: unknown) =>
        err instanceof LlmCitationError &&
        /Unclassified posts were 2 of 10, above the 10% limit/.test(err.message),
    );
  });

  it("shows aliases in the prompt and leaves the post id out", () => {
    const plan = planAnalysisInput(marketPosts, "analyst");
    const prompt = buildUserPrompt("What is the outlook?", plan.sent);
    assert.match(prompt, /alias: p1/);
    assert.equal(prompt.includes("crypto-a"), false);
    assert.equal(prompt.includes("postId:"), false);
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
