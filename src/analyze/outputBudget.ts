import { LLM_MAX_EXPLANATION_CHARS } from "../config/llmSettings.js";

/** Words allowed in one post-classification reason. */
export const CLASSIFICATION_REASON_MAX_WORDS = 20;

/**
 * Character bound on a classification reason.
 * It keeps the worst-case JSON finite for the local token ceiling.
 */
export const CLASSIFICATION_REASON_MAX_CHARS = 120;

/** Snowflake-sized id used only to size the worst-case output. */
const OUTPUT_ID_CHARS = 20;

/** Longest class name first, so the worst-case JSON uses the longest labels. */
const OUTPUT_ASSET_CLASSES = [
  "rates_bonds",
  "commodities",
  "equities",
  "crypto",
  "macro",
  "fx",
] as const;

/**
 * Pessimistic output-token ceiling for one classification response.
 * One token per UTF-8 byte of the largest JSON the schema can return
 * for this many posts. Each id is cited once, in the outlook for its
 * own asset class. Reasons are at the character bound.
 */
export function classificationOutputTokenCeiling(sentCount: number): number {
  const count = sentCount < 1 ? 1 : sentCount;
  const postId = "1".repeat(OUTPUT_ID_CHARS);
  const reason = "x".repeat(CLASSIFICATION_REASON_MAX_CHARS);
  const classCount = Math.min(count, OUTPUT_ASSET_CLASSES.length);
  const classes = OUTPUT_ASSET_CLASSES.slice(0, classCount);
  const posts: Array<{
    postId: string;
    relevant: true;
    asset_class: (typeof OUTPUT_ASSET_CLASSES)[number];
    stance: "unclear";
    reason: string;
  }> = [];
  const assetOutlooks = classes.map((asset_class, index) => {
    const n = index === 0 ? count - (classCount - 1) : 1;
    const evidencePostIds: string[] = [];
    for (let i = 0; i < n; i++) {
      posts.push({
        postId,
        relevant: true,
        asset_class,
        stance: "unclear",
        reason,
      });
      evidencePostIds.push(postId);
    }
    return {
      asset_class,
      outlook: "cautious" as const,
      evidencePostIds,
    };
  });
  const payload = {
    outlook: "cautious",
    explanation: "e".repeat(LLM_MAX_EXPLANATION_CHARS),
    posts,
    assetOutlooks,
  };
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}
