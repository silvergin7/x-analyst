import {
  CLASSIFICATION_REASON_MAX_CHARS,
  CLASSIFICATION_REASON_MAX_WORDS,
} from "./outputBudget.js";
import { STALE_RELEVANT_POST_DAYS, isOlderThanDays } from "../config/timeWindow.js";
import { LLM_MAX_EXPLANATION_CHARS } from "../config/llmSettings.js";
import type {
  AssetClass,
  AssetClassOutlook,
  EvidenceRef,
  MarketOutlook,
  PostClassification,
  Stance,
} from "../types.js";
import { compareTimestamp } from "./analysisInput.js";
import type { SentPost } from "./analysisInput.js";
import { LlmCitationError, LlmOutputError } from "./llmErrors.js";

const OVERALL_OUTLOOKS = new Set<MarketOutlook>([
  "bullish",
  "bearish",
  "cautious",
  "mixed",
  "unclear",
]);

const ASSET_CLASSES = new Set<AssetClass>([
  "equities",
  "rates_bonds",
  "crypto",
  "commodities",
  "fx",
  "macro",
  "none",
]);

const OUTLOOK_ASSET_CLASSES = new Set<Exclude<AssetClass, "none">>([
  "equities",
  "rates_bonds",
  "crypto",
  "commodities",
  "fx",
  "macro",
]);

const STANCES = new Set<Stance>(["bullish", "bearish", "neutral", "unclear"]);

export interface ParsedModelOutlook {
  outlook: MarketOutlook;
  explanation: string;
  posts: PostClassification[];
  assetOutlooks: Array<{
    assetClass: Exclude<AssetClass, "none">;
    outlook: MarketOutlook;
    evidencePostIds: string[];
  }>;
}

export interface CheckedOutlook {
  outlook: MarketOutlook;
  explanation: string;
  classifications: PostClassification[];
  assetOutlooks: AssetClassOutlook[];
  evidence: EvidenceRef[];
  relevantPostCount: number;
  newestRelevantPostAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

function readClassification(value: unknown, index: number): PostClassification {
  if (!isRecord(value)) {
    throw new LlmOutputError(`Classification ${index} was not an object`);
  }
  const keys = Object.keys(value);
  const allowed = ["postId", "relevant", "asset_class", "stance", "reason"];
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))) {
    throw new LlmOutputError(`Classification ${index} did not match the schema`);
  }
  if (typeof value.postId !== "string" || value.postId.trim() === "") {
    throw new LlmOutputError(`Classification ${index} had an invalid postId`);
  }
  if (typeof value.relevant !== "boolean") {
    throw new LlmOutputError(`Classification ${index} relevant was not a boolean`);
  }
  if (typeof value.asset_class !== "string" || !ASSET_CLASSES.has(value.asset_class as AssetClass)) {
    throw new LlmOutputError(`Classification ${index} had an invalid asset_class`);
  }
  if (typeof value.stance !== "string" || !STANCES.has(value.stance as Stance)) {
    throw new LlmOutputError(`Classification ${index} had an invalid stance`);
  }
  if (typeof value.reason !== "string" || value.reason.trim() === "") {
    throw new LlmOutputError(`Classification ${index} reason was empty`);
  }
  if (value.reason.length > CLASSIFICATION_REASON_MAX_CHARS) {
    throw new LlmOutputError(`Classification ${index} reason exceeded the character bound`);
  }
  if (wordCount(value.reason) > CLASSIFICATION_REASON_MAX_WORDS) {
    throw new LlmOutputError(`Classification ${index} reason exceeded 20 words`);
  }
  const assetClass = value.asset_class as AssetClass;
  if (value.relevant && assetClass === "none") {
    throw new LlmOutputError(
      `Classification ${index} is relevant and must name an asset class`,
    );
  }
  return {
    postId: value.postId,
    relevant: value.relevant,
    assetClass,
    stance: value.stance as Stance,
    reason: value.reason,
  };
}

function readAssetOutlook(value: unknown, index: number): ParsedModelOutlook["assetOutlooks"][number] {
  if (!isRecord(value)) {
    throw new LlmOutputError(`Asset outlook ${index} was not an object`);
  }
  const keys = Object.keys(value);
  const allowed = ["asset_class", "outlook", "evidencePostIds"];
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))) {
    throw new LlmOutputError(`Asset outlook ${index} did not match the schema`);
  }
  if (
    typeof value.asset_class !== "string" ||
    !OUTLOOK_ASSET_CLASSES.has(value.asset_class as Exclude<AssetClass, "none">)
  ) {
    throw new LlmOutputError(`Asset outlook ${index} had an invalid asset_class`);
  }
  if (typeof value.outlook !== "string" || !OVERALL_OUTLOOKS.has(value.outlook as MarketOutlook)) {
    throw new LlmOutputError(`Asset outlook ${index} had an invalid outlook`);
  }
  if (!Array.isArray(value.evidencePostIds)) {
    throw new LlmOutputError(`Asset outlook ${index} evidencePostIds was not an array`);
  }
  if (!value.evidencePostIds.every((id) => typeof id === "string" && id.trim() !== "")) {
    throw new LlmOutputError(`Asset outlook ${index} cited an invalid post id`);
  }
  return {
    assetClass: value.asset_class as Exclude<AssetClass, "none">,
    outlook: value.outlook as MarketOutlook,
    evidencePostIds: value.evidencePostIds as string[],
  };
}

/** Parse the strict classification object. Id coverage is checked separately. */
export function parseModelOutlook(content: string): ParsedModelOutlook {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new LlmOutputError("Model content was not JSON");
  }
  if (!isRecord(value)) {
    throw new LlmOutputError("Model content was not a JSON object");
  }
  const keys = Object.keys(value);
  const allowed = ["outlook", "explanation", "posts", "assetOutlooks"];
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))) {
    throw new LlmOutputError("Model JSON did not match the outlook schema");
  }
  if (typeof value.outlook !== "string" || !OVERALL_OUTLOOKS.has(value.outlook as MarketOutlook)) {
    throw new LlmOutputError("Model outlook was not a supported value");
  }
  if (typeof value.explanation !== "string" || value.explanation.trim() === "") {
    throw new LlmOutputError("Model explanation was empty");
  }
  if (value.explanation.length > LLM_MAX_EXPLANATION_CHARS) {
    throw new LlmOutputError("Model explanation exceeded the length limit");
  }
  if (!Array.isArray(value.posts)) {
    throw new LlmOutputError("Model posts was not an array");
  }
  if (!Array.isArray(value.assetOutlooks)) {
    throw new LlmOutputError("Model assetOutlooks was not an array");
  }
  return {
    outlook: value.outlook as MarketOutlook,
    explanation: value.explanation,
    posts: value.posts.map((item, index) => readClassification(item, index)),
    assetOutlooks: value.assetOutlooks.map((item, index) => readAssetOutlook(item, index)),
  };
}

function evidenceFor(post: SentPost): EvidenceRef {
  return {
    postId: post.post.id,
    url: post.post.url,
    timestamp: post.post.timestamp,
    kind: post.post.kind,
  };
}

/**
 * Every sent id is classified once. Unknown and missing ids fail the run.
 * Relevant posts are those classified relevant. Each such asset class has one outlook.
 */
export function checkClassifications(
  sent: readonly SentPost[],
  parsed: ParsedModelOutlook,
  referenceDate: string,
): CheckedOutlook {
  const sentIds = sent.map((item) => item.post.id);
  const sentById = new Map(sent.map((item) => [item.post.id, item]));
  const seen = new Map<string, number>();
  for (const item of parsed.posts) {
    if (!sentById.has(item.postId)) {
      throw new LlmCitationError(`Citation id ${item.postId} was not in the model input`);
    }
    seen.set(item.postId, (seen.get(item.postId) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count !== 1) {
      throw new LlmCitationError(`Classification id ${id} was repeated`);
    }
  }
  for (const id of sentIds) {
    if (!seen.has(id)) {
      throw new LlmCitationError(`Classification missing sent id ${id}`);
    }
  }

  const relevant = parsed.posts.filter((item) => item.relevant);
  if (parsed.outlook !== "unclear" && relevant.length === 0) {
    throw new LlmCitationError("A stated outlook requires at least one relevant post");
  }

  const relevantByClass = new Map<Exclude<AssetClass, "none">, PostClassification[]>();
  for (const item of relevant) {
    if (item.assetClass === "none") continue;
    const list = relevantByClass.get(item.assetClass) ?? [];
    list.push(item);
    relevantByClass.set(item.assetClass, list);
  }

  const outlookClasses = parsed.assetOutlooks.map((item) => item.assetClass);
  const uniqueOutlookClasses = new Set(outlookClasses);
  if (uniqueOutlookClasses.size !== outlookClasses.length) {
    throw new LlmCitationError("An asset class outlook was repeated");
  }
  for (const assetClass of relevantByClass.keys()) {
    if (!uniqueOutlookClasses.has(assetClass)) {
      throw new LlmCitationError(`Missing outlook for asset class ${assetClass}`);
    }
  }
  for (const assetClass of uniqueOutlookClasses) {
    if (!relevantByClass.has(assetClass)) {
      throw new LlmCitationError(`Asset class ${assetClass} has an outlook without relevant posts`);
    }
  }

  const assetOutlooks: AssetClassOutlook[] = parsed.assetOutlooks.map((item) => {
    const classPosts = relevantByClass.get(item.assetClass) ?? [];
    const classIds = new Set(classPosts.map((post) => post.postId));
    const cited = new Set<string>();
    const evidence: EvidenceRef[] = [];
    if (item.outlook !== "unclear" && item.evidencePostIds.length === 0) {
      throw new LlmCitationError(
        `Asset class ${item.assetClass} outlook requires a relevant post id`,
      );
    }
    for (const id of item.evidencePostIds) {
      if (cited.has(id)) {
        throw new LlmCitationError(`Asset class ${item.assetClass} cited ${id} more than once`);
      }
      cited.add(id);
      if (!classIds.has(id)) {
        throw new LlmCitationError(
          `Asset class ${item.assetClass} cited ${id}, which is not a relevant post of that class`,
        );
      }
      const sentPost = sentById.get(id);
      if (!sentPost) {
        throw new LlmCitationError(`Citation id ${id} was not in the model input`);
      }
      evidence.push(evidenceFor(sentPost));
    }
    const newest = [...classPosts].sort((a, b) => {
      const aPost = sentById.get(a.postId)!;
      const bPost = sentById.get(b.postId)!;
      return compareTimestamp(
        bPost.post.timestamp,
        b.postId,
        aPost.post.timestamp,
        a.postId,
      );
    })[0]!;
    const newestPost = sentById.get(newest.postId)!;
    return {
      assetClass: item.assetClass,
      outlook: item.outlook,
      evidence,
      newestRelevantPostAt: newestPost.post.timestamp,
      viewMayBeStale: isOlderThanDays(
        newestPost.post.timestamp,
        referenceDate,
        STALE_RELEVANT_POST_DAYS,
      ),
    };
  });

  const relevantEvidence = relevant.map((item) => evidenceFor(sentById.get(item.postId)!));
  let newestRelevantPostAt: string | undefined;
  if (relevantEvidence.length > 0) {
    const newest = [...relevantEvidence].sort((a, b) =>
      compareTimestamp(b.timestamp, b.postId, a.timestamp, a.postId),
    )[0]!;
    newestRelevantPostAt = newest.timestamp;
  }

  return {
    outlook: parsed.outlook,
    explanation: parsed.explanation,
    classifications: parsed.posts,
    assetOutlooks,
    evidence: relevantEvidence,
    relevantPostCount: relevant.length,
    newestRelevantPostAt,
  };
}
