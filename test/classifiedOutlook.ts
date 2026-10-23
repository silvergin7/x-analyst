import type { SentPost } from "../src/analyze/analysisInput.js";
import { postAliases } from "../src/analyze/postAliases.js";

/** Build a valid classification payload for fake model responses. */
export function classifiedOutlook(input: {
  outlook: "bullish" | "bearish" | "cautious" | "mixed" | "unclear";
  explanation: string;
  posts: Array<{
    postId: string;
    relevant?: boolean;
    asset_class?: "equities" | "rates_bonds" | "crypto" | "commodities" | "fx" | "macro" | "none";
    stance?: "bullish" | "bearish" | "neutral" | "unclear";
    reason?: string;
  }>;
  assetOutlooks?: Array<{
    asset_class: string;
    outlook: string;
    evidencePostIds: string[];
  }>;
}): {
  outlook: string;
  explanation: string;
  posts: Array<{
    postId: string;
    relevant: boolean;
    asset_class: string;
    stance: string;
    reason: string;
  }>;
  assetOutlooks: Array<{
    asset_class: string;
    outlook: string;
    evidencePostIds: string[];
  }>;
} {
  const posts = input.posts.map((post) => {
    const relevant = post.relevant ?? false;
    return {
      postId: post.postId,
      relevant,
      asset_class: post.asset_class ?? (relevant ? "macro" : "none"),
      stance: post.stance ?? (relevant ? "bullish" : "unclear"),
      reason: post.reason ?? (relevant ? "Shows a market view." : "Not about markets."),
    };
  });
  const relevant = posts.filter((post) => post.relevant && post.asset_class !== "none");
  const classes = [...new Set(relevant.map((post) => post.asset_class))];
  const assetOutlooks =
    input.assetOutlooks ??
    classes.map((asset_class) => ({
      asset_class,
      outlook: input.outlook,
      evidencePostIds: relevant
        .filter((post) => post.asset_class === asset_class)
        .map((post) => post.postId),
    }));
  return {
    outlook: input.outlook,
    explanation: input.explanation,
    posts,
    assetOutlooks,
  };
}

/** Model JSON: alias keys, with real ids mapped from the sent posts. Unknown ids stay unknown aliases. */
export function aliasModel(
  sent: readonly SentPost[],
  payload: ReturnType<typeof classifiedOutlook>,
) {
  const aliasById = new Map(postAliases(sent).map((item) => [item.post.post.id, item.alias]));
  const posts: Record<
    string,
    { relevant: boolean; asset_class: string; stance: string; reason: string }
  > = {};
  for (const post of payload.posts) {
    posts[aliasById.get(post.postId) ?? post.postId] = {
      relevant: post.relevant,
      asset_class: post.asset_class,
      stance: post.stance,
      reason: post.reason,
    };
  }
  return {
    outlook: payload.outlook,
    explanation: payload.explanation,
    posts,
    assetOutlooks: payload.assetOutlooks.map((item) => ({
      asset_class: item.asset_class,
      outlook: item.outlook,
      evidencePostIds: item.evidencePostIds.map((id) => aliasById.get(id) ?? id),
    })),
  };
}
