import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planAnalysisInput } from "../src/analyze/analysisInput.js";
import {
  CLASSIFICATION_INVALID_REASON,
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

function checked(payload: ReturnType<typeof classifiedOutlook>, posts: Post[] = marketPosts) {
  const plan = planAnalysisInput(posts, "analyst");
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

function fillerPosts(count: number): Post[] {
  return Array.from({ length: count }, (_, index) =>
    post({
      id: `fill-${index}`,
      kind: "original",
      text: `Macro filler post ${index}.`,
      timestamp: `2026-10-0${(index % 8) + 1}T12:00:00.000Z`,
    }),
  );
}

function allIrrelevantPosts(posts: Post[]) {
  return posts.map((item) => ({
    postId: item.id,
    relevant: false,
    reason: "Not about markets.",
  }));
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

  it("marks a long reason as classification_invalid and still accepts 120", () => {
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
    const longPosts = [...fillerPosts(6), ...marketPosts];
    const longPlan = planAnalysisInput(longPosts, "analyst");
    const longAliases = postAliases(longPlan.sent);
    const longNames = longAliases.map((item) => item.alias);
    const longModel = aliasModel(
      longPlan.sent,
      classifiedOutlook({
        outlook: "unclear",
        explanation: "Mostly filler.",
        posts: [
          ...allIrrelevantPosts(fillerPosts(6)),
          { postId: "noise", relevant: false },
          {
            postId: "crypto-a",
            relevant: true,
            asset_class: "crypto",
            stance: "bullish",
            reason: "x".repeat(CLASSIFICATION_REASON_MAX_CHARS + 1),
          },
          { postId: "crypto-b", relevant: false },
          { postId: "rates-old", relevant: false },
        ],
      }),
    );
    const resolvedLong = resolveAliasClassifications(
      longAliases,
      parseModelOutlook(JSON.stringify(longModel), longNames),
    );
    const invalidLong = resolvedLong.posts.find(
      (item) => item.postId === "crypto-a",
    );
    assert.equal(invalidLong?.reason, CLASSIFICATION_INVALID_REASON);
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
    const wordPosts = [...fillerPosts(6), ...marketPosts];
    const wordPlan = planAnalysisInput(wordPosts, "analyst");
    const wordAliases = postAliases(wordPlan.sent);
    const wordNames = wordAliases.map((item) => item.alias);
    const wordModel = aliasModel(
      wordPlan.sent,
      classifiedOutlook({
        outlook: "unclear",
        explanation: "Mostly filler.",
        posts: [
          ...allIrrelevantPosts(fillerPosts(6)),
          {
            postId: "noise",
            relevant: false,
            reason: "word ".repeat(21).trim(),
          },
          { postId: "crypto-a", relevant: false },
          { postId: "crypto-b", relevant: false },
          { postId: "rates-old", relevant: false },
        ],
      }),
    );
    const resolvedWords = resolveAliasClassifications(
      wordAliases,
      parseModelOutlook(JSON.stringify(wordModel), wordNames),
    );
    const invalidWords = resolvedWords.posts.find((item) => item.postId === "noise");
    assert.equal(invalidWords?.reason, CLASSIFICATION_INVALID_REASON);
  });

  it("drops an asset outlook when its only cited post has a long reason", () => {
    const posts = [...fillerPosts(6), ...marketPosts];
    const longReason = "x".repeat(CLASSIFICATION_REASON_MAX_CHARS + 5);
    const result = checked(
      classifiedOutlook({
        outlook: "unclear",
        explanation: "Only cited crypto post was invalid.",
        posts: [
          ...allIrrelevantPosts(fillerPosts(6)),
          { postId: "noise", relevant: false },
          {
            postId: "crypto-a",
            relevant: true,
            asset_class: "crypto",
            stance: "bullish",
            reason: longReason,
          },
          {
            postId: "crypto-b",
            relevant: true,
            asset_class: "crypto",
            stance: "bearish",
            reason: "Valid second crypto view.",
          },
          { postId: "rates-old", relevant: false },
        ],
        assetOutlooks: [
          { asset_class: "crypto", outlook: "bullish", evidencePostIds: ["crypto-a"] },
        ],
      }),
      posts,
    );
    assert.equal(result.assetOutlooks.length, 0);
    assert.deepEqual(result.assetOutlooksDropped, ["crypto"]);
    assert.equal(result.evidenceDroppedUnclassified, 1);
    assert.throws(
      () =>
        checked(
          classifiedOutlook({
            outlook: "bullish",
            explanation: "Needs at least one eligible post.",
            posts: [
              ...allIrrelevantPosts(fillerPosts(6)),
              {
                postId: "crypto-a",
                relevant: true,
                asset_class: "crypto",
                stance: "bullish",
                reason: longReason,
              },
              { postId: "crypto-b", relevant: false },
              { postId: "rates-old", relevant: false },
              { postId: "noise", relevant: false },
            ],
            assetOutlooks: [
              { asset_class: "crypto", outlook: "bullish", evidencePostIds: ["crypto-a"] },
            ],
          }),
          posts,
        ),
      (err: unknown) =>
        err instanceof LlmCitationError &&
        /A stated outlook requires at least one relevant post/.test(err.message),
    );
  });

  it("keeps an asset outlook when one of two cited posts has a long reason", () => {
    const posts = [...fillerPosts(6), ...marketPosts];
    const longReason = "x".repeat(CLASSIFICATION_REASON_MAX_CHARS + 3);
    const result = checked(
      classifiedOutlook({
        outlook: "mixed",
        explanation: "One crypto post still supports the view.",
        posts: [
          ...allIrrelevantPosts(fillerPosts(6)),
          { postId: "noise", relevant: false },
          {
            postId: "crypto-a",
            relevant: true,
            asset_class: "crypto",
            stance: "bullish",
            reason: longReason,
          },
          {
            postId: "crypto-b",
            relevant: true,
            asset_class: "crypto",
            stance: "bearish",
            reason: "Still cautious on the spike.",
          },
          { postId: "rates-old", relevant: false },
        ],
        assetOutlooks: [
          {
            asset_class: "crypto",
            outlook: "mixed",
            evidencePostIds: ["crypto-a", "crypto-b"],
          },
        ],
      }),
      posts,
    );
    assert.equal(result.assetOutlooks.length, 1);
    assert.equal(result.assetOutlooks[0]?.evidence.length, 1);
    assert.equal(result.evidenceDroppedUnclassified, 1);
  });

  it("truncates an overlong explanation instead of failing the handle", () => {
    const plan = planAnalysisInput(marketPosts, "analyst");
    const aliases = postAliases(plan.sent);
    const names = aliases.map((item) => item.alias);
    const parsed = parseModelOutlook(
      JSON.stringify({
        outlook: "unclear",
        explanation: "e".repeat(1600),
        posts: Object.fromEntries(
          aliases.map((item) => [
            item.alias,
            {
              relevant: false,
              asset_class: "none",
              stance: "unclear",
              reason: "Not market related.",
            },
          ]),
        ),
        assetOutlooks: [],
      }),
      names,
    );
    assert.equal(parsed.explanation.length, 1500);
    assert.equal(parsed.explanationTruncated, true);
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

  it("fails when an asset outlook names a class with no model-relevant posts", () => {
    assert.throws(
      () =>
        checked(classifiedOutlook({
          outlook: "mixed",
          explanation: "Rates outlook without any relevant rates posts.",
          posts: [
            { postId: "noise", relevant: false },
            { postId: "crypto-a", relevant: true, asset_class: "crypto", stance: "bullish" },
            { postId: "crypto-b", relevant: true, asset_class: "crypto", stance: "bearish" },
            { postId: "rates-old", relevant: false },
          ],
          assetOutlooks: [
            { asset_class: "crypto", outlook: "mixed", evidencePostIds: ["crypto-a"] },
            { asset_class: "rates_bonds", outlook: "cautious", evidencePostIds: ["rates-old"] },
          ],
        })),
      (err: unknown) =>
        err instanceof LlmCitationError &&
        /Asset class rates_bonds has no relevant posts in the model classifications/.test(err.message),
    );
  });

  it("fails when a non-unclear asset outlook cites no posts", () => {
    assert.throws(
      () =>
        checked(classifiedOutlook({
          outlook: "mixed",
          explanation: "Crypto bullish but evidence list empty.",
          posts: [
            { postId: "noise", relevant: false },
            { postId: "crypto-a", relevant: true, asset_class: "crypto", stance: "bullish" },
            { postId: "crypto-b", relevant: true, asset_class: "crypto", stance: "bearish" },
            { postId: "rates-old", relevant: false },
          ],
          assetOutlooks: [
            { asset_class: "crypto", outlook: "bullish", evidencePostIds: [] },
          ],
        })),
      (err: unknown) =>
        err instanceof LlmCitationError &&
        /Asset class crypto cited no posts for a non-unclear outlook/.test(err.message),
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
