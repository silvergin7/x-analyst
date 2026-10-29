import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { FETCH_STOP_LABEL, STALE_RELEVANT_POST_DAYS } from "../../src/config/timeWindow";
import type { FetchStopReason } from "../../src/types";

interface MetaResponse {
  mode: "viewer";
  demo: boolean;
  description: string;
  liveApiEnabled: false;
}

type MetaState =
  | { status: "loading" }
  | { status: "ok"; meta: MetaResponse }
  | { status: "error"; message: string };

interface InvalidHandle {
  raw: string;
  reason: string;
}

interface EvidenceItem {
  postId: string;
  url: string;
  timestamp: string;
  kind: string;
}

interface AnalysisInputItem {
  postId: string;
  timestamp?: string;
  disposition: string;
  reason: string;
  originalChars: number;
  sentChars: number;
  sentExcerpt?: string;
  quotedPostExcerpt?: string;
}

interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface BillingItem {
  costUsd?: number;
  usageCount?: number;
  service?: string;
  currency?: string;
}

interface PostClassification {
  postId: string;
  relevant: boolean;
  assetClass: string;
  stance: string;
  reason: string;
}

interface HandleFailure {
  handle: string;
  message: string;
  providerUsage?: ProviderUsage;
  budgetEstimate?: { estimatedUsd: number };
}

interface OutlookReport {
  handle: string;
  outlook: string;
  explanation: string;
  dateRangeExamined: { from: string; to: string } | null;
  postsExamined: number;
  retrievalComplete: boolean;
  retrievalIncompleteReason?: string;
  evidence: EvidenceItem[];
  analysisInput?: AnalysisInputItem[];
  providerUsage?: ProviderUsage | null;
  modelInvoked?: boolean;
  llmModel?: string;
  llmModelsTried?: string[];
  llmModelAttempts?: Array<{ modelId: string; kind: "sent" | "skipped"; durationMs?: number }>;
  tokenizerPin?: { root: string; commit: string; sha256: string };
  eligiblePostCount?: number;
  relevantPostCount?: number;
  newestRelevantPostAt?: string;
  viewMayBeStale?: boolean;
  fetchStopReason?: FetchStopReason;
  duplicatePostsRemoved?: number;
  invalidPostsSkipped?: Record<string, number>;
  postsWithMedia?: number;
  assetOutlooks?: Array<{
    assetClass: string;
    outlook: string;
    newestRelevantPostAt: string;
    viewMayBeStale: boolean;
    evidence: EvidenceItem[];
  }>;
  classifications?: PostClassification[];
}

type FetchOutcome =
  | {
      status: "ok";
      handle: string;
      incompleteReason?: string;
      failureCategory?: string;
      httpStatus?: number;
      reason?: string;
    }
  | { status: "incomplete"; handle: string; reason: string }
  | { status: "unknown_handle"; handle: string }
  | { status: "invalid_handle"; handle: string; reason: string }
  | { status: "empty"; handle: string }
  | {
      status: "retrieval_failed";
      handle: string;
      failureCategory: string;
      reason: string;
      httpStatus?: number;
    };

interface AnalyzeSuccess {
  question: string;
  postsSource: "fixtures" | "desearch";
  analysisSource: "mock-rules" | "chutes";
  referenceDate: string;
  fetchedAt: string;
  fetchedCommit?: string;
  reused: boolean;
  replayed?: boolean;
  billing: BillingItem[];
  invalidHandles: InvalidHandle[];
  fetchOutcomes: FetchOutcome[];
  reports: OutlookReport[];
  handleFailures: HandleFailure[];
}

interface StatusLine {
  key: string;
  text: string;
}

type RunState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "error";
      message: string;
      invalidHandles: InvalidHandle[];
      providerUsages?: ProviderUsage[];
      billing?: BillingItem[];
      fetchedAt?: string;
      reused?: boolean;
      sliceStored?: boolean;
    }
  | { status: "ok"; result: AnalyzeSuccess };

const OUTLOOKS = new Set(["bullish", "bearish", "cautious", "mixed", "unclear"]);
const POST_KINDS = new Set(["original", "repost", "quote"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function readAnalysisInput(value: unknown): AnalysisInputItem[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const records: AnalysisInputItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.postId) ||
      !isNonEmptyString(item.disposition) ||
      typeof item.reason !== "string" ||
      !isCount(item.originalChars) ||
      !isCount(item.sentChars)
    ) {
      return null;
    }
    const timestamp = item.timestamp;
    if (timestamp !== undefined && !isNonEmptyString(timestamp)) return null;
    if (item.sentExcerpt !== undefined && typeof item.sentExcerpt !== "string") return null;
    if (item.quotedPostExcerpt !== undefined && typeof item.quotedPostExcerpt !== "string") {
      return null;
    }
    records.push({
      postId: item.postId,
      ...(isNonEmptyString(timestamp) ? { timestamp } : {}),
      disposition: item.disposition,
      reason: item.reason,
      originalChars: item.originalChars,
      sentChars: item.sentChars,
      ...(typeof item.sentExcerpt === "string" ? { sentExcerpt: item.sentExcerpt } : {}),
      ...(typeof item.quotedPostExcerpt === "string"
        ? { quotedPostExcerpt: item.quotedPostExcerpt }
        : {}),
    });
  }
  return records;
}

function readProviderUsage(value: unknown): ProviderUsage | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !isCount(value.promptTokens) ||
    !isCount(value.completionTokens) ||
    !isCount(value.totalTokens)
  ) {
    return undefined;
  }
  return {
    promptTokens: value.promptTokens,
    completionTokens: value.completionTokens,
    totalTokens: value.totalTokens,
  };
}

function readBilling(value: unknown): BillingItem[] | null {
  if (!Array.isArray(value)) return null;
  const billing: BillingItem[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const entry: BillingItem = {};
    if (item.costUsd !== undefined) {
      if (typeof item.costUsd !== "number" || !Number.isFinite(item.costUsd)) return null;
      entry.costUsd = item.costUsd;
    }
    if (item.usageCount !== undefined) {
      if (!isCount(item.usageCount)) return null;
      entry.usageCount = item.usageCount;
    }
    if (item.service !== undefined) {
      if (typeof item.service !== "string") return null;
      entry.service = item.service;
    }
    if (item.currency !== undefined) {
      if (typeof item.currency !== "string") return null;
      entry.currency = item.currency;
    }
    billing.push(entry);
  }
  return billing;
}

function readProviderUsages(value: unknown): ProviderUsage[] {
  if (!Array.isArray(value)) return [];
  const usages: ProviderUsage[] = [];
  for (const item of value) {
    const usage = readProviderUsage(item);
    if (usage) usages.push(usage);
  }
  return usages;
}

function readSourcePair(
  value: Record<string, unknown>,
): { postsSource: "fixtures" | "desearch"; analysisSource: "mock-rules" | "chutes" } | null {
  if (value.postsSource !== "fixtures" && value.postsSource !== "desearch") return null;
  if (value.analysisSource !== "mock-rules" && value.analysisSource !== "chutes") return null;
  return { postsSource: value.postsSource, analysisSource: value.analysisSource };
}

function readInvalidHandles(value: unknown): InvalidHandle[] | null {
  if (!Array.isArray(value)) return null;
  const handles: InvalidHandle[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.raw !== "string" || typeof item.reason !== "string") {
      return null;
    }
    handles.push({ raw: item.raw, reason: item.reason });
  }
  return handles;
}

function readDateRange(
  value: unknown,
): { from: string; to: string } | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isNonEmptyString(value.from) || !isNonEmptyString(value.to)) {
    return undefined;
  }
  return { from: value.from, to: value.to };
}

function readEvidence(value: unknown): EvidenceItem[] | null {
  if (!Array.isArray(value)) return null;
  const evidence: EvidenceItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.postId) ||
      !isNonEmptyString(item.url) ||
      !isNonEmptyString(item.timestamp) ||
      typeof item.kind !== "string" ||
      !POST_KINDS.has(item.kind)
    ) {
      return null;
    }
    evidence.push({
      postId: item.postId,
      url: item.url,
      timestamp: item.timestamp,
      kind: item.kind,
    });
  }
  return evidence;
}

function readAssetOutlooks(value: unknown): OutlookReport["assetOutlooks"] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const outlooks: NonNullable<OutlookReport["assetOutlooks"]> = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.assetClass) ||
      typeof item.outlook !== "string" ||
      !OUTLOOKS.has(item.outlook) ||
      !isNonEmptyString(item.newestRelevantPostAt) ||
      typeof item.viewMayBeStale !== "boolean"
    ) {
      return null;
    }
    const evidence = readEvidence(item.evidence);
    if (!evidence) return null;
    outlooks.push({
      assetClass: item.assetClass,
      outlook: item.outlook,
      newestRelevantPostAt: item.newestRelevantPostAt,
      viewMayBeStale: item.viewMayBeStale,
      evidence,
    });
  }
  return outlooks;
}

function readModelAttempts(
  value: unknown,
): Array<{ modelId: string; kind: "sent" | "skipped"; durationMs?: number }> | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const attempts: Array<{ modelId: string; kind: "sent" | "skipped"; durationMs?: number }> = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") return null;
    const record = item as { modelId?: unknown; kind?: unknown; durationMs?: unknown };
    if (!isNonEmptyString(record.modelId)) return null;
    if (record.kind !== "sent" && record.kind !== "skipped") return null;
    if (record.durationMs === undefined) {
      attempts.push({ modelId: record.modelId, kind: record.kind });
      continue;
    }
    if (typeof record.durationMs !== "number" || !Number.isFinite(record.durationMs) || record.durationMs < 0) {
      return null;
    }
    attempts.push({ modelId: record.modelId, kind: record.kind, durationMs: record.durationMs });
  }
  return attempts;
}

function readReport(value: unknown): OutlookReport | null {
  if (!isRecord(value) || !isNonEmptyString(value.handle)) return null;
  if (typeof value.outlook !== "string" || !OUTLOOKS.has(value.outlook)) return null;
  if (typeof value.explanation !== "string" || !isCount(value.postsExamined)) return null;
  if (typeof value.retrievalComplete !== "boolean") return null;
  if (
    value.retrievalIncompleteReason !== undefined &&
    typeof value.retrievalIncompleteReason !== "string"
  ) {
    return null;
  }
  const dateRangeExamined = readDateRange(value.dateRangeExamined);
  if (dateRangeExamined === undefined) return null;
  const evidence = readEvidence(value.evidence);
  if (!evidence) return null;
  const analysisInput = readAnalysisInput(value.analysisInput);
  if (analysisInput === null) return null;
  const providerUsage = readProviderUsage(value.providerUsage);
  if (value.providerUsage !== undefined && value.providerUsage !== null && !providerUsage) {
    return null;
  }
  if (value.eligiblePostCount !== undefined && !isCount(value.eligiblePostCount)) return null;
  if (value.relevantPostCount !== undefined && !isCount(value.relevantPostCount)) return null;
  if (
    value.newestRelevantPostAt !== undefined &&
    !isNonEmptyString(value.newestRelevantPostAt)
  ) {
    return null;
  }
  if (value.viewMayBeStale !== undefined && typeof value.viewMayBeStale !== "boolean") {
    return null;
  }
  if (
    value.fetchStopReason !== undefined &&
    (typeof value.fetchStopReason !== "string" ||
      !Object.hasOwn(FETCH_STOP_LABEL, value.fetchStopReason))
  ) {
    return null;
  }
  const assetOutlooks = readAssetOutlooks(value.assetOutlooks);
  if (assetOutlooks === null) return null;
  if (value.duplicatePostsRemoved !== undefined && !isCount(value.duplicatePostsRemoved)) {
    return null;
  }
  const invalidPostsSkipped = readSkipCounts(value.invalidPostsSkipped);
  if (invalidPostsSkipped === null) return null;
  if (value.postsWithMedia !== undefined && !isCount(value.postsWithMedia)) return null;
  const classifications = readClassifications(value.classifications);
  if (classifications === null) return null;
  const llmModelAttempts = readModelAttempts(value.llmModelAttempts);
  if (llmModelAttempts === null) return null;
  return {
    handle: value.handle,
    outlook: value.outlook,
    explanation: value.explanation,
    dateRangeExamined,
    postsExamined: value.postsExamined,
    retrievalComplete: value.retrievalComplete,
    retrievalIncompleteReason: value.retrievalIncompleteReason,
    evidence,
    analysisInput,
    providerUsage,
    modelInvoked: typeof value.modelInvoked === "boolean" ? value.modelInvoked : undefined,
    ...(isNonEmptyString(value.llmModel) ? { llmModel: value.llmModel } : {}),
    ...(Array.isArray(value.llmModelsTried) &&
    value.llmModelsTried.every((item) => typeof item === "string")
      ? { llmModelsTried: value.llmModelsTried as string[] }
      : {}),
    ...(llmModelAttempts !== undefined ? { llmModelAttempts } : {}),
    ...(value.tokenizerPin &&
    typeof value.tokenizerPin === "object" &&
    isNonEmptyString((value.tokenizerPin as { root?: string }).root) &&
    isNonEmptyString((value.tokenizerPin as { commit?: string }).commit) &&
    isNonEmptyString((value.tokenizerPin as { sha256?: string }).sha256)
      ? {
          tokenizerPin: value.tokenizerPin as { root: string; commit: string; sha256: string },
        }
      : {}),
    ...(isCount(value.eligiblePostCount) ? { eligiblePostCount: value.eligiblePostCount } : {}),
    ...(isCount(value.relevantPostCount) ? { relevantPostCount: value.relevantPostCount } : {}),
    ...(isNonEmptyString(value.newestRelevantPostAt)
      ? { newestRelevantPostAt: value.newestRelevantPostAt }
      : {}),
    ...(typeof value.viewMayBeStale === "boolean" ? { viewMayBeStale: value.viewMayBeStale } : {}),
    ...(typeof value.fetchStopReason === "string" &&
    Object.hasOwn(FETCH_STOP_LABEL, value.fetchStopReason)
      ? { fetchStopReason: value.fetchStopReason as FetchStopReason }
      : {}),
    ...(assetOutlooks ? { assetOutlooks } : {}),
    ...(isCount(value.duplicatePostsRemoved)
      ? { duplicatePostsRemoved: value.duplicatePostsRemoved }
      : {}),
    ...(invalidPostsSkipped ? { invalidPostsSkipped } : {}),
    ...(isCount(value.postsWithMedia) ? { postsWithMedia: value.postsWithMedia } : {}),
    ...(classifications ? { classifications } : {}),
  };
}

function readSkipCounts(value: unknown): Record<string, number> | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (!isCount(count)) return null;
    out[key] = count;
  }
  return out;
}

function readClassifications(value: unknown): PostClassification[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const rows: PostClassification[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.postId) ||
      typeof item.relevant !== "boolean" ||
      !isNonEmptyString(item.assetClass) ||
      !isNonEmptyString(item.stance) ||
      typeof item.reason !== "string"
    ) {
      return null;
    }
    rows.push({
      postId: item.postId,
      relevant: item.relevant,
      assetClass: item.assetClass,
      stance: item.stance,
      reason: item.reason,
    });
  }
  return rows;
}

function readHandleFailures(value: unknown): HandleFailure[] | null {
  if (!Array.isArray(value)) return null;
  const failures: HandleFailure[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isNonEmptyString(item.handle) || typeof item.message !== "string") {
      return null;
    }
    failures.push({
      handle: item.handle,
      message: item.message,
      providerUsage: readProviderUsage(item.providerUsage) ?? undefined,
      budgetEstimate:
        isRecord(item.budgetEstimate) &&
        typeof item.budgetEstimate.estimatedUsd === "number"
          ? { estimatedUsd: item.budgetEstimate.estimatedUsd }
          : undefined,
    });
  }
  return failures;
}

function readFetchOutcome(value: unknown): FetchOutcome | null {
  if (!isRecord(value) || !isNonEmptyString(value.handle) || typeof value.status !== "string") {
    return null;
  }
  if (value.status === "ok") {
    return {
      status: "ok",
      handle: value.handle,
      ...(typeof value.incompleteReason === "string"
        ? { incompleteReason: value.incompleteReason }
        : {}),
      ...(typeof value.failureCategory === "string"
        ? { failureCategory: value.failureCategory }
        : {}),
      ...(typeof value.httpStatus === "number" ? { httpStatus: value.httpStatus } : {}),
      ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    };
  }
  if (value.status === "unknown_handle" || value.status === "empty") {
    return { status: value.status, handle: value.handle };
  }
  if (value.status === "incomplete" || value.status === "invalid_handle") {
    if (typeof value.reason !== "string") return null;
    return { status: value.status, handle: value.handle, reason: value.reason };
  }
  if (value.status === "retrieval_failed") {
    if (
      typeof value.reason !== "string" ||
      typeof value.failureCategory !== "string"
    ) {
      return null;
    }
    return {
      status: "retrieval_failed",
      handle: value.handle,
      failureCategory: value.failureCategory,
      reason: value.reason,
      ...(typeof value.httpStatus === "number" ? { httpStatus: value.httpStatus } : {}),
    };
  }
  return null;
}

function readAnalyzeSuccess(value: unknown): AnalyzeSuccess | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.fetchOutcomes) || !Array.isArray(value.reports)) return null;
  const sources = readSourcePair(value);
  if (!sources) return null;
  if (!isNonEmptyString(value.referenceDate) || !isNonEmptyString(value.fetchedAt)) return null;
  if (typeof value.reused !== "boolean") return null;
  const billing = readBilling(value.billing);
  if (!billing) return null;
  const invalidHandles =
    value.invalidHandles === undefined ? [] : readInvalidHandles(value.invalidHandles);
  if (invalidHandles === null) return null;
  const fetchOutcomes: FetchOutcome[] = [];
  for (const item of value.fetchOutcomes) {
    const outcome = readFetchOutcome(item);
    if (!outcome) return null;
    fetchOutcomes.push(outcome);
  }
  const reports: OutlookReport[] = [];
  for (const item of value.reports) {
    const report = readReport(item);
    if (!report) return null;
    reports.push(report);
  }
  const handleFailures =
    value.handleFailures === undefined ? [] : readHandleFailures(value.handleFailures);
  if (handleFailures === null) return null;
  if (!isNonEmptyString(value.question)) return null;
  return {
    ...sources,
    question: value.question,
    referenceDate: value.referenceDate,
    fetchedAt: value.fetchedAt,
    fetchedCommit: isNonEmptyString(value.fetchedCommit) ? value.fetchedCommit : undefined,
    reused: value.reused,
    replayed: typeof value.replayed === "boolean" ? value.replayed : undefined,
    billing,
    invalidHandles,
    fetchOutcomes,
    reports,
    handleFailures,
  };
}

function sameInvalid(raw: string, handle: string): boolean {
  return raw.trim().toLowerCase() === handle.trim().toLowerCase();
}

export function statusLines(input: {
  invalidHandles: InvalidHandle[];
  fetchOutcomes: FetchOutcome[];
  postsSource?: "fixtures" | "desearch";
}): StatusLine[] {
  const lines: StatusLine[] = input.invalidHandles.map((item, index) => ({
    key: `invalid-${index}-${item.raw}`,
    text: `Invalid handle "${item.raw}": ${item.reason}`,
  }));

  input.fetchOutcomes.forEach((outcome, index) => {
    if (outcome.status === "ok") {
      if (outcome.incompleteReason) {
        const halt =
          outcome.failureCategory !== undefined
            ? ` (${outcome.failureCategory}${
                outcome.httpStatus !== undefined ? ` HTTP ${outcome.httpStatus}` : ""
              }${outcome.reason !== undefined ? `: ${outcome.reason}` : ""})`
            : "";
        lines.push({
          key: `partial-${index}-${outcome.handle}`,
          text: `@${outcome.handle}: partial retrieval (${outcome.incompleteReason})${halt}`,
        });
      }
      return;
    }
    if (
      outcome.status === "invalid_handle" &&
      input.invalidHandles.some((item) => sameInvalid(item.raw, outcome.handle))
    ) {
      return;
    }
    if (outcome.status === "invalid_handle") {
      lines.push({
        key: `invalid-outcome-${index}-${outcome.handle}`,
        text: `Invalid handle "${outcome.handle}": ${outcome.reason}`,
      });
      return;
    }
    if (outcome.status === "unknown_handle") {
      lines.push({
        key: `unknown-${index}-${outcome.handle}`,
        text:
          input.postsSource === "desearch"
            ? `Unknown handle "${outcome.handle}" (not returned by retrieval)`
            : `Unknown handle "${outcome.handle}" (not in the fixture catalog)`,
      });
      return;
    }
    if (outcome.status === "empty") {
      lines.push({
        key: `empty-${index}-${outcome.handle}`,
        text:
          input.postsSource === "desearch"
            ? `No posts for "${outcome.handle}" in the retrieved slice`
            : `No posts for "${outcome.handle}" in the fixtures`,
      });
      return;
    }
    lines.push({
      key: `unexamined-${index}-${outcome.handle}`,
      text: `@${outcome.handle} was not examined (${outcome.reason}). No outlook was inferred.`,
    });
  });

  return lines;
}

function StatusList({ lines }: { lines: StatusLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="status-list" aria-label="Handles without an outlook">
      {lines.map((line) => (
        <li key={line.key}>{line.text}</li>
      ))}
    </ul>
  );
}

function usageText(usage: ProviderUsage | null | undefined, modelInvoked?: boolean): string | null {
  if (modelInvoked === false) return "Provider usage: no request was sent";
  if (usage === undefined) return null;
  if (usage === null) return "Provider usage: not reported";
  return `Provider usage: prompt_tokens=${usage.promptTokens} completion_tokens=${usage.completionTokens} total_tokens=${usage.totalTokens}`;
}

function billingText(item: BillingItem): string {
  const parts: string[] = [];
  if (item.costUsd !== undefined) parts.push(`Desearch reported cost USD ${item.costUsd}`);
  if (item.usageCount !== undefined) parts.push(`Desearch usage count ${item.usageCount}`);
  if (item.service) parts.push(`Service ${item.service}`);
  if (item.currency) parts.push(`Currency ${item.currency}`);
  return parts.join(". ");
}

function ReportCard({
  report,
  postsSource,
}: {
  report: OutlookReport;
  postsSource: "fixtures" | "desearch";
}) {
  const headingId = `report-${report.handle}`;
  return (
    <article className="report-card" aria-labelledby={headingId}>
      <h3 id={headingId} className="report-card__handle">
        @{report.handle}
      </h3>
      <p className="report-card__outlook">Outlook: {report.outlook}</p>
      <p>{report.explanation}</p>
      <p>Posts examined: {report.postsExamined}</p>
      {report.eligiblePostCount !== undefined && report.relevantPostCount !== undefined && (
        <p>
          Relevant posts: {report.relevantPostCount} of {report.eligiblePostCount} eligible
        </p>
      )}
      {report.newestRelevantPostAt && <p>Newest relevant post: {report.newestRelevantPostAt}</p>}
      {report.viewMayBeStale && !report.assetOutlooks?.some((item) => item.viewMayBeStale) && (
        <p>
          The newest relevant post is older than {STALE_RELEVANT_POST_DAYS} days. The view may be
          stale.
        </p>
      )}
      {report.duplicatePostsRemoved !== undefined && report.duplicatePostsRemoved > 0 && (
        <p>Duplicate post ids removed: {report.duplicatePostsRemoved}</p>
      )}
      {report.invalidPostsSkipped !== undefined &&
        Object.keys(report.invalidPostsSkipped).length > 0 && (
          <p>
            Invalid posts skipped:{" "}
            {Object.entries(report.invalidPostsSkipped)
              .map(([code, count]) => `${code}: ${count}`)
              .join(", ")}
          </p>
        )}
      {report.postsWithMedia !== undefined && <p>Posts with media: {report.postsWithMedia}</p>}
      {report.assetOutlooks && report.assetOutlooks.length > 0 && (
        <>
          <h4>Asset outlooks</h4>
          <ul>
            {report.assetOutlooks.map((item) => (
              <li key={item.assetClass}>
                {item.assetClass}: {item.outlook}. Newest relevant post: {item.newestRelevantPostAt}
                {item.viewMayBeStale && (
                  <p>
                    {item.assetClass}: The newest relevant post is older than {STALE_RELEVANT_POST_DAYS}{" "}
                    days. The view may be stale.
                  </p>
                )}
                <p>
                  Cited relevant posts:{" "}
                  {item.evidence.length === 0
                    ? "none"
                    : item.evidence.map((evidence) => evidence.postId).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {report.fetchStopReason && (
        <p>Fetch stopped: {FETCH_STOP_LABEL[report.fetchStopReason]}</p>
      )}
      {report.dateRangeExamined ? (
        <p>
          Date range of retrieved slice: {report.dateRangeExamined.from} → {report.dateRangeExamined.to}
        </p>
      ) : (
        <p>No date range was returned for this report.</p>
      )}
      {report.retrievalComplete ? (
        <p>Retrieval coverage: complete</p>
      ) : (
        <p>
          {report.retrievalIncompleteReason
            ? `Partial retrieval: ${report.retrievalIncompleteReason}`
            : "Partial retrieval"}
        </p>
      )}
      <h4 className="report-card__evidence-heading">Evidence</h4>
      {report.evidence.length === 0 ? (
        <p>No supporting evidence in the examined slice.</p>
      ) : (
        <ul className="evidence-list">
          {report.evidence.map((item) => (
            <li key={item.postId}>
              <p className="evidence-list__fixture">
                {postsSource === "fixtures"
                  ? "Fictional fixture link, not a live X link"
                  : "Retrieved post link"}
              </p>
              <a href={item.url}>{item.url}</a>
              <p>Author: {report.handle}</p>
              <p>Timestamp: {item.timestamp}</p>
              <p>Post ID: {item.postId}</p>
              <p>Kind: {item.kind}</p>
            </li>
          ))}
        </ul>
      )}
      {report.classifications && report.classifications.length > 0 && (
        <>
          <h4>Classification table</h4>
          <table>
            <thead>
              <tr>
                <th scope="col">Post</th>
                <th scope="col">Relevant</th>
                <th scope="col">Asset class</th>
                <th scope="col">Stance</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {report.classifications.map((row) => (
                <tr key={row.postId}>
                  <td>{row.postId}</td>
                  <td>{row.relevant ? "yes" : "no"}</td>
                  <td>{row.assetClass}</td>
                  <td>{row.stance}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {report.analysisInput && report.analysisInput.length > 0 && (
        <>
          <h4>Excluded and truncated posts</h4>
          <ul>
            {report.analysisInput
              .filter((item) => item.disposition === "excluded")
              .map((item) => (
                <li key={`excluded-${item.postId}-${item.reason}`}>
                  {item.postId}: {item.reason}
                </li>
              ))}
          </ul>
          <h4>Analysis input</h4>
          <ul>
            {report.analysisInput.map((item) => (
              <li key={item.postId}>
                {item.postId}
                {item.timestamp ? ` ${item.timestamp}` : ""}: {item.disposition} ({item.reason},{" "}
                {item.originalChars} to {item.sentChars} characters)
                {item.sentExcerpt !== undefined && <p>Sent text: {item.sentExcerpt}</p>}
                {item.quotedPostExcerpt !== undefined && (
                  <p>Quoted post text: {item.quotedPostExcerpt}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {report.llmModel && <p>Chutes model: {report.llmModel}</p>}
      {report.llmModelAttempts && report.llmModelAttempts.length > 0 && (
        <p>
          Chutes models:{" "}
          {report.llmModelAttempts
            .map((item) =>
              item.kind === "skipped"
                ? `${item.modelId} (skipped)`
                : item.durationMs !== undefined
                  ? `${item.modelId} (${item.durationMs} ms)`
                  : item.modelId,
            )
            .join(", ")}
        </p>
      )}
      {!report.llmModelAttempts &&
        report.llmModelsTried &&
        report.llmModelsTried.length > 1 && (
          <p>Models tried: {report.llmModelsTried.join(", ")}</p>
        )}
      {report.tokenizerPin && (
        <p>
          Tokenizer pin: {report.tokenizerPin.root}@{report.tokenizerPin.commit.slice(0, 8)}… (
          {report.tokenizerPin.sha256.slice(0, 12)}…)
        </p>
      )}
      {usageText(report.providerUsage, report.modelInvoked) && (
        <p>{usageText(report.providerUsage, report.modelInvoked)}</p>
      )}
    </article>
  );
}

export function App() {
  const [metaState, setMetaState] = useState<MetaState>({ status: "loading" });
  const [reportOptions, setReportOptions] = useState<string[]>([]);
  const [selectedReport, setSelectedReport] = useState("");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/meta");
        if (!res.ok) {
          throw new Error(`API returned ${res.status}`);
        }
        const meta = (await res.json()) as MetaResponse;
        const listRes = await fetch("/api/reports");
        const listJson = listRes.ok ? ((await listRes.json()) as { reports?: string[] }) : null;
        if (!cancelled) {
          setMetaState({ status: "ok", meta });
          const reports = Array.isArray(listJson?.reports) ? listJson.reports : [];
          setReportOptions(reports);
          if (reports[0]) setSelectedReport(reports[0]);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Could not reach local API";
          setMetaState({ status: "error", message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadReportFromApi(basename: string) {
    if (inFlight.current || basename === "") return;
    inFlight.current = true;
    setRun({ status: "loading" });
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(basename)}`);
      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        if (mounted.current) {
          setRun({
            status: "error",
            message: `API returned ${res.status}`,
            invalidHandles: [],
          });
        }
        return;
      }
      if (!res.ok) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : `API returned ${res.status}`;
        const record = isRecord(payload) ? payload : undefined;
        if (mounted.current) {
          setRun({
            status: "error",
            message,
            invalidHandles: readInvalidHandles(record?.invalidHandles) ?? [],
            providerUsages: readProviderUsages(record?.providerUsages),
            billing: readBilling(record?.billing) ?? undefined,
            fetchedAt: record && isNonEmptyString(record.fetchedAt) ? record.fetchedAt : undefined,
            reused: record && typeof record.reused === "boolean" ? record.reused : undefined,
            sliceStored: record && typeof record.sliceStored === "boolean" ? record.sliceStored : undefined,
          });
        }
        return;
      }
      const result = readAnalyzeSuccess(payload);
      if (!result) {
        if (mounted.current) {
          setRun({
            status: "error",
            message: "API returned an unexpected response",
            invalidHandles: [],
          });
        }
        return;
      }
      if (mounted.current) {
        setRun({ status: "ok", result });
      }
    } catch {
      if (mounted.current) {
        setRun({
          status: "error",
          message: "Could not reach the local API",
          invalidHandles: [],
        });
      }
    } finally {
      inFlight.current = false;
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadReportFromApi(selectedReport);
  }

  async function onUploadJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setRun({ status: "loading" });
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const result = readAnalyzeSuccess(payload);
      if (!result) {
        setRun({
          status: "error",
          message: "The selected file is not a saved report",
          invalidHandles: [],
        });
        return;
      }
      setRun({ status: "ok", result });
    } catch {
      setRun({
        status: "error",
        message: "Could not read the selected JSON file",
        invalidHandles: [],
      });
    }
  }

  const status =
    run.status === "ok"
      ? statusLines(run.result)
      : run.status === "error"
        ? statusLines({ invalidHandles: run.invalidHandles, fetchOutcomes: [] })
        : [];
  const meta = metaState.status === "ok" ? metaState.meta : null;

  return (
    <div className="app">
      <header className="demo-banner" role="status">
        <p className="demo-banner__title">Saved report viewer</p>
        <p className="demo-banner__sub">{meta?.description}</p>
      </header>

      <main className="main">
        <h1 className="title">x-analyst report viewer</h1>
        <p className="lede">
          Open a JSON report written by <code>npm run analyze</code>. This page never starts a live
          fetch or model call.
        </p>

        <form className="analyze-form" aria-label="Open saved report" onSubmit={onSubmit}>
          <label className="analyze-form__field" htmlFor="report-id">
            Saved report
            <select
              id="report-id"
              name="report-id"
              value={selectedReport}
              onChange={(event) => setSelectedReport(event.target.value)}
            >
              {reportOptions.length === 0 ? (
                <option value="">No reports in data/reports/</option>
              ) : (
                reportOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              )}
            </select>
          </label>
          <button type="submit" disabled={run.status === "loading" || selectedReport === ""}>
            {run.status === "loading" ? "Loading…" : "Open report"}
          </button>
        </form>
        <label className="analyze-form__field" htmlFor="report-upload">
          Or upload a report JSON file
          <input id="report-upload" type="file" accept="application/json,.json" onChange={onUploadJson} />
        </label>

        <section className="results" aria-live="polite" aria-label="Analysis results">
          {run.status === "loading" && <p className="results__loading">Loading…</p>}
          {run.status === "error" && (
            <div>
              <p className="form-error" role="alert">
                {run.message}
              </p>
              {run.sliceStored !== undefined && (
                <p>The run failed. No complete report was produced.</p>
              )}
              {run.providerUsages?.map((usage, index) => (
                <p key={`error-usage-${index}`}>{usageText(usage)}</p>
              ))}
              {run.billing?.map((item, index) => (
                <p key={`error-billing-${index}`}>{billingText(item)}</p>
              ))}
              {run.sliceStored && run.fetchedAt && (
                <p>
                  {run.reused ? "Reused an earlier slice." : "Fetched a new slice."} Fetched at{" "}
                  {run.fetchedAt}.
                </p>
              )}
              {run.sliceStored === false && <p>Slice: not stored.</p>}
            </div>
          )}
          <StatusList lines={status} />
          {run.status === "ok" && (
            <>
              <p>Question: {run.result.question}</p>
              <p>
                Posts source: {run.result.postsSource}. Analysis source: {run.result.analysisSource}.
                Analysis reference date: {run.result.referenceDate}.
              </p>
              <p>
                Slice:{" "}
                {run.result.replayed
                  ? "replayed"
                  : run.result.reused
                    ? "reused"
                    : "fetched"}
                . Fetched at {run.result.fetchedAt}
                {run.result.fetchedCommit ? ` (commit ${run.result.fetchedCommit})` : ""}.
              </p>
              {run.result.billing.map((item, index) => (
                <p key={`billing-${index}`}>{billingText(item)}</p>
              ))}
              {run.result.handleFailures.map((failure) => (
                <p key={failure.handle} className="form-error">
                  @{failure.handle}: {failure.message}
                  {failure.budgetEstimate
                    ? ` Local estimate $${failure.budgetEstimate.estimatedUsd.toFixed(6)} (not provider usage).`
                    : ""}
                  {failure.providerUsage
                    ? ` Provider usage prompt_tokens=${failure.providerUsage.promptTokens}.`
                    : ""}
                </p>
              ))}
              {run.result.reports.map((report) => (
                <ReportCard
                  key={report.handle}
                  report={report}
                  postsSource={run.result.postsSource}
                />
              ))}
            </>
          )}
        </section>

        <section className="meta-panel" aria-labelledby="meta-heading">
          <h2 id="meta-heading" className="meta-panel__heading">
            API meta check
          </h2>
          {metaState.status === "loading" && (
            <p className="meta-panel__status">Contacting /api/meta…</p>
          )}
          {metaState.status === "error" && (
            <p className="meta-panel__error" role="alert">
              {metaState.message}. Start the API with{" "}
              <code>npm run dev:server</code>, then run{" "}
              <code>npm run dev:web</code>.
            </p>
          )}
          {metaState.status === "ok" && (
            <dl className="meta-list">
              <div>
                <dt>Mode</dt>
                <dd>{metaState.meta.mode}</dd>
              </div>
              <div>
                <dt>Demo</dt>
                <dd>{metaState.meta.demo ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>Live API</dt>
                <dd>disabled</dd>
              </div>
              <div className="meta-list__wide">
                <dt>Description</dt>
                <dd>{metaState.meta.description}</dd>
              </div>
            </dl>
          )}
        </section>
      </main>
    </div>
  );
}
