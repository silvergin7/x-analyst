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
