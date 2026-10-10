import { LLM_MAX_EXPLANATION_CHARS } from "../config/llmSettings.js";

/** Words allowed in one post-classification reason. */
export const CLASSIFICATION_REASON_MAX_WORDS = 20;

/**
 * Character bound on a classification reason.
 * It keeps the worst-case JSON finite for the local token ceiling.
 */
export const CLASSIFICATION_REASON_MAX_CHARS = 240;

/** Snowflake-sized id used only to size the worst-case output. */
const OUTPUT_ID_CHARS = 20;

const OUTPUT_ASSET_CLASSES = [
  "equities",
  "rates_bonds",
  "crypto",
  "commodities",
  "fx",
  "macro",
] as const;

/**
 * Pessimistic output-token ceiling for one classification response.
 * One token per UTF-8 byte of the largest JSON the schema can return
 * for this many posts, including a reason at the character bound and
 * an outlook for every asset class citing every post.
 */
export function classificationOutputTokenCeiling(sentCount: number): number {
  const count = sentCount < 1 ? 1 : sentCount;
  const postId = "1".repeat(OUTPUT_ID_CHARS);
  const reason = "x".repeat(CLASSIFICATION_REASON_MAX_CHARS);
  const posts = Array.from({ length: count }, () => ({
    postId,
    relevant: true,
    asset_class: "rates_bonds",
    stance: "unclear",
    reason,
  }));
  const evidencePostIds = Array.from({ length: count }, () => postId);
  const assetOutlooks = OUTPUT_ASSET_CLASSES.map((asset_class) => ({
    asset_class,
    outlook: "cautious",
    evidencePostIds,
  }));
  const payload = {
    outlook: "cautious",
    explanation: "e".repeat(LLM_MAX_EXPLANATION_CHARS),
    posts,
    assetOutlooks,
  };
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}
