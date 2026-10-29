import {
  CLASSIFICATION_REASON_MAX_CHARS,
  CLASSIFICATION_REASON_MAX_WORDS,
} from "./outputBudget.js";
import { STALE_RELEVANT_POST_DAYS, isOlderThanDays } from "../config/timeWindow.js";
import { LLM_MAX_EXPLANATION_CHARS, UNCLASSIFIED_POST_SHARE_LIMIT } from "../config/llmSettings.js";
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
import type { PostAlias } from "./postAliases.js";

export const UNCLASSIFIED_BY_MODEL_REASON = "unclassified_by_model";
export const CLASSIFICATION_INVALID_REASON = "classification_invalid";

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
  explanationTruncated?: boolean;
  softInvalidAliases?: ReadonlySet<string>;
  /** Model marked relevant:true in this asset class before soft-fail (invalid reason, etc.). */
  softInvalidRelevantInClass?: Partial<Record<Exclude<AssetClass, "none">, number>>;
}

export interface CheckedOutlook {
  outlook: MarketOutlook;
  explanation: string;
  classifications: PostClassification[];
  assetOutlooks: AssetClassOutlook[];
  evidence: EvidenceRef[];
  relevantPostCount: number;
  newestRelevantPostAt?: string;
  evidenceDroppedUnclassified?: number;
  assetOutlooksDropped?: Exclude<AssetClass, "none">[];
  explanationTruncated?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

function classificationSoftInvalid(value: Record<string, unknown>): boolean {
  if (typeof value.reason !== "string" || value.reason.trim() === "") return true;
  if (value.reason.length > CLASSIFICATION_REASON_MAX_CHARS) return true;
  if (wordCount(value.reason) > CLASSIFICATION_REASON_MAX_WORDS) return true;
  if (value.relevant === true && value.asset_class === "none") return true;
  return false;
}

function readClassification(value: unknown, alias: string): Omit<PostClassification, "postId"> {
  if (!isRecord(value)) {
    throw new LlmOutputError(`Classification ${alias} was not an object`);
  }
  const keys = Object.keys(value);
  const allowed = ["relevant", "asset_class", "stance", "reason"];
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))) {
    throw new LlmOutputError(`Classification ${alias} did not match the schema`);
  }
  if (typeof value.relevant !== "boolean") {
    throw new LlmOutputError(`Classification ${alias} relevant was not a boolean`);
  }
  if (typeof value.asset_class !== "string" || !ASSET_CLASSES.has(value.asset_class as AssetClass)) {
    throw new LlmOutputError(`Classification ${alias} had an invalid asset_class`);
  }
  if (typeof value.stance !== "string" || !STANCES.has(value.stance as Stance)) {
    throw new LlmOutputError(`Classification ${alias} had an invalid stance`);
  }
  if (typeof value.reason !== "string") {
    throw new LlmOutputError(`Classification ${alias} reason was not a string`);
  }
  if (classificationSoftInvalid(value)) {
    throw new LlmOutputError(`Classification ${alias} was invalid under soft-fail rules`);
  }
  const assetClass = value.asset_class as AssetClass;
  return {
    relevant: value.relevant,
    assetClass,
    stance: value.stance as Stance,
    reason: value.reason,
  };
}

function tryReadClassification(
  value: unknown,
  alias: string,
): { ok: true; value: Omit<PostClassification, "postId"> } | { ok: false; soft: boolean } {
  if (!isRecord(value)) {
    return { ok: false, soft: false };
  }
  const keys = Object.keys(value);
  const allowed = ["relevant", "asset_class", "stance", "reason"];
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))) {
    return { ok: false, soft: false };
  }
  if (typeof value.relevant !== "boolean") return { ok: false, soft: false };
  if (typeof value.asset_class !== "string" || !ASSET_CLASSES.has(value.asset_class as AssetClass)) {
    return { ok: false, soft: false };
  }
  if (typeof value.stance !== "string" || !STANCES.has(value.stance as Stance)) {
    return { ok: false, soft: false };
  }
  if (typeof value.reason !== "string") return { ok: false, soft: false };
  if (classificationSoftInvalid(value)) return { ok: false, soft: true };
  const assetClass = value.asset_class as AssetClass;
  return {
    ok: true,
    value: {
      relevant: value.relevant,
      assetClass,
      stance: value.stance as Stance,
      reason: value.reason,
    },
  };
}

function isEligibleRelevant(classification: PostClassification): boolean {
  return (
    classification.relevant &&
    classification.reason !== UNCLASSIFIED_BY_MODEL_REASON &&
    classification.reason !== CLASSIFICATION_INVALID_REASON
  );
}

function classificationById(posts: readonly PostClassification[]): Map<string, PostClassification> {
  return new Map(posts.map((item) => [item.postId, item]));
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

/** Parse the strict classification object. Alias coverage is checked separately. */
export function parseModelOutlook(
  content: string,
  aliases: readonly string[],
): ParsedModelOutlook {
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
  let explanation = value.explanation;
  let explanationTruncated = false;
  if (explanation.length > LLM_MAX_EXPLANATION_CHARS) {
    explanation = explanation.slice(0, LLM_MAX_EXPLANATION_CHARS);
    explanationTruncated = true;
  }
  if (!isRecord(value.posts)) {
    throw new LlmOutputError("Model posts was not an object");
  }
  if (!Array.isArray(value.assetOutlooks)) {
    throw new LlmOutputError("Model assetOutlooks was not an array");
  }
  const allowedAliases = new Set(aliases);
  const posts: PostClassification[] = [];
  const softInvalidAliases = new Set<string>();
  const softInvalidRelevantInClass: Partial<Record<Exclude<AssetClass, "none">, number>> = {};
  for (const [alias, item] of Object.entries(value.posts)) {
    if (!allowedAliases.has(alias)) {
      throw new LlmCitationError(`Unknown alias ${alias}`);
    }
    const read = tryReadClassification(item, alias);
    if (!read.ok) {
      if (read.soft) {
        softInvalidAliases.add(alias);
        if (isRecord(item) && item.relevant === true) {
          const assetClass = item.asset_class;
          if (
            typeof assetClass === "string" &&
            OUTLOOK_ASSET_CLASSES.has(assetClass as Exclude<AssetClass, "none">)
          ) {
            const key = assetClass as Exclude<AssetClass, "none">;
            softInvalidRelevantInClass[key] = (softInvalidRelevantInClass[key] ?? 0) + 1;
          }
        }
      } else throw new LlmOutputError(`Classification ${alias} did not match the schema`);
      continue;
    }
    posts.push({ postId: alias, ...read.value });
  }
  return {
    outlook: value.outlook as MarketOutlook,
    explanation,
    posts,
    assetOutlooks: value.assetOutlooks.map((item, index) => readAssetOutlook(item, index)),
    ...(explanationTruncated ? { explanationTruncated: true } : {}),
    ...(softInvalidAliases.size > 0 ? { softInvalidAliases } : {}),
    ...(Object.keys(softInvalidRelevantInClass).length > 0 ? { softInvalidRelevantInClass } : {}),
  };
}

/**
 * Map aliases back to post ids. A missing alias is unclassified.
 * More than UNCLASSIFIED_POST_SHARE_LIMIT of the sent posts fails the handle.
 * An unknown alias fails the handle.
 */
export function resolveAliasClassifications(
  aliases: readonly PostAlias[],
  parsed: ParsedModelOutlook,
): ParsedModelOutlook {
  const idByAlias = new Map(aliases.map((item) => [item.alias, item.post.post.id]));
  const seen = new Set<string>();
  const posts: PostClassification[] = [];
  for (const item of parsed.posts) {
    const postId = idByAlias.get(item.postId);
    if (postId === undefined) {
      throw new LlmCitationError(`Unknown alias ${item.postId}`);
    }
    if (seen.has(item.postId)) {
      throw new LlmCitationError(`Alias ${item.postId} was repeated`);
    }
    seen.add(item.postId);
    posts.push({ ...item, postId });
  }
  const softInvalid = parsed.softInvalidAliases ?? new Set<string>();
  const missing = aliases.filter(
    (item) => !seen.has(item.alias) && !softInvalid.has(item.alias),
  );
  const unclassifiedCount = missing.length + softInvalid.size;
  if (
    aliases.length > 0 &&
    unclassifiedCount / aliases.length > UNCLASSIFIED_POST_SHARE_LIMIT
  ) {
    throw new LlmCitationError(
      `Unclassified posts were ${unclassifiedCount} of ${aliases.length}, above the ${Math.round(UNCLASSIFIED_POST_SHARE_LIMIT * 100)}% limit`,
    );
  }
  for (const item of missing) {
    posts.push({
      postId: item.post.post.id,
      relevant: false,
      assetClass: "none",
      stance: "unclear",
      reason: UNCLASSIFIED_BY_MODEL_REASON,
    });
  }
  for (const alias of softInvalid) {
    const postId = idByAlias.get(alias);
    if (postId === undefined) {
      throw new LlmCitationError(`Unknown alias ${alias}`);
    }
    posts.push({
      postId,
      relevant: false,
      assetClass: "none",
      stance: "unclear",
      reason: CLASSIFICATION_INVALID_REASON,
    });
  }
  return {
    ...parsed,
    posts,
    assetOutlooks: parsed.assetOutlooks.map((item) => ({
      ...item,
      evidencePostIds: item.evidencePostIds.map((alias) => {
        const postId = idByAlias.get(alias);
        if (postId === undefined) {
          throw new LlmCitationError(`Unknown alias ${alias}`);
        }
        return postId;
      }),
    })),
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
 * Every sent id is classified once. Unknown ids fail the handle.
 * Relevant posts are those classified relevant. Each such asset class has one outlook.
 * A post id is cited in at most one outlook, and only for its classified asset class.
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

  const byId = classificationById(parsed.posts);
  const relevantEligible = parsed.posts.filter(isEligibleRelevant);
  if (parsed.outlook !== "unclear" && relevantEligible.length === 0) {
    throw new LlmCitationError("A stated outlook requires at least one relevant post");
  }

  const relevantByClass = new Map<Exclude<AssetClass, "none">, PostClassification[]>();
  for (const item of relevantEligible) {
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

  const citedByOutlook = new Map<string, Exclude<AssetClass, "none">>();
  let evidenceDroppedUnclassified = 0;
  const assetOutlooksDropped: Exclude<AssetClass, "none">[] = [];
  const assetOutlooks: AssetClassOutlook[] = [];
  for (const item of parsed.assetOutlooks) {
    const classPosts = relevantByClass.get(item.assetClass) ?? [];
    const softRelevantInClass = parsed.softInvalidRelevantInClass?.[item.assetClass] ?? 0;
    const modelHadRelevantInClass = classPosts.length > 0 || softRelevantInClass > 0;
    if (!modelHadRelevantInClass) {
      throw new LlmCitationError(
        `Asset class ${item.assetClass} has no relevant posts in the model classifications`,
      );
    }
    if (classPosts.length === 0) {
      assetOutlooksDropped.push(item.assetClass);
      continue;
    }
    if (item.evidencePostIds.length === 0 && item.outlook !== "unclear") {
      throw new LlmCitationError(
        `Asset class ${item.assetClass} cited no posts for a non-unclear outlook`,
      );
    }
    const classIds = new Set(classPosts.map((post) => post.postId));
    const cited = new Set<string>();
    const evidence: EvidenceRef[] = [];
    let droppedInvalidCitations = 0;
    for (const id of item.evidencePostIds) {
      if (cited.has(id)) {
        throw new LlmCitationError(`Asset class ${item.assetClass} cited ${id} more than once`);
      }
      cited.add(id);
      const priorOutlook = citedByOutlook.get(id);
      if (priorOutlook !== undefined) {
        throw new LlmCitationError(`Post id ${id} was cited in more than one asset outlook`);
      }
      const classification = byId.get(id);
      if (classification === undefined) {
        throw new LlmCitationError(`Citation id ${id} was not in the model input`);
      }
      if (
        classification.reason === UNCLASSIFIED_BY_MODEL_REASON ||
        classification.reason === CLASSIFICATION_INVALID_REASON
      ) {
        evidenceDroppedUnclassified += 1;
        droppedInvalidCitations += 1;
        continue;
      }
      if (!classIds.has(id)) {
        throw new LlmCitationError(
          `Asset class ${item.assetClass} cited ${id}, which is not a relevant post of that class`,
        );
      }
      citedByOutlook.set(id, item.assetClass);
      const sentPost = sentById.get(id);
      if (!sentPost) {
        throw new LlmCitationError(`Citation id ${id} was not in the model input`);
      }
      evidence.push(evidenceFor(sentPost));
    }
    if (item.outlook !== "unclear" && evidence.length === 0) {
      if (
        droppedInvalidCitations > 0 &&
        droppedInvalidCitations === item.evidencePostIds.length
      ) {
        assetOutlooksDropped.push(item.assetClass);
        continue;
      }
      throw new LlmCitationError(
        `Asset class ${item.assetClass} has no remaining evidence for a non-unclear outlook`,
      );
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
    assetOutlooks.push({
      assetClass: item.assetClass,
      outlook: item.outlook,
      evidence,
      newestRelevantPostAt: newestPost.post.timestamp,
      viewMayBeStale: isOlderThanDays(
        newestPost.post.timestamp,
        referenceDate,
        STALE_RELEVANT_POST_DAYS,
      ),
    });
  }

  const relevantEvidence = relevantEligible.map((item) => evidenceFor(sentById.get(item.postId)!));
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
    relevantPostCount: relevantEligible.length,
    newestRelevantPostAt,
    ...(evidenceDroppedUnclassified > 0 ? { evidenceDroppedUnclassified } : {}),
    ...(assetOutlooksDropped.length > 0 ? { assetOutlooksDropped } : {}),
    ...(parsed.explanationTruncated ? { explanationTruncated: true } : {}),
  };
}
