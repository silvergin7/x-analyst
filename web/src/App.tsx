import { useEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_HANDLES, DEFAULT_QUESTION } from "../../src/config";

interface MetaResponse {
  mode: "mock" | "live";
  demo: boolean;
  description: string;
  postsSource: "fixtures" | "desearch";
  analysisSource: "mock-rules" | "chutes";
  liveApiEnabled: boolean;
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
  disposition: string;
  reason: string;
  originalChars: number;
  sentChars: number;
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
}

type FetchOutcome =
  | { status: "ok"; handle: string }
  | { status: "incomplete"; handle: string; reason: string }
  | { status: "unknown_handle"; handle: string }
  | { status: "invalid_handle"; handle: string; reason: string }
  | { status: "empty"; handle: string };

interface AnalyzeSuccess {
  postsSource: "fixtures" | "desearch";
  analysisSource: "mock-rules" | "chutes";
  referenceDate: string;
  fetchedAt: string;
  reused: boolean;
  billing: BillingItem[];
  invalidHandles: InvalidHandle[];
  fetchOutcomes: FetchOutcome[];
  reports: OutlookReport[];
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

const OUTLOOKS = new Set(["bullish", "bearish", "cautious", "unclear"]);
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
    records.push({
      postId: item.postId,
      disposition: item.disposition,
      reason: item.reason,
      originalChars: item.originalChars,
      sentChars: item.sentChars,
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
  };
}

function readFetchOutcome(value: unknown): FetchOutcome | null {
  if (!isRecord(value) || !isNonEmptyString(value.handle) || typeof value.status !== "string") {
    return null;
  }
  if (value.status === "ok" || value.status === "unknown_handle" || value.status === "empty") {
    return { status: value.status, handle: value.handle };
  }
  if (value.status === "incomplete" || value.status === "invalid_handle") {
    if (typeof value.reason !== "string") return null;
    return { status: value.status, handle: value.handle, reason: value.reason };
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
  const invalidHandles = readInvalidHandles(value.invalidHandles);
  if (!invalidHandles) return null;
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
  return { ...sources, referenceDate: value.referenceDate, fetchedAt: value.fetchedAt, reused: value.reused, billing, invalidHandles, fetchOutcomes, reports };
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
    if (outcome.status === "ok") return;
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
      {report.dateRangeExamined ? (
        <p>
          Dates examined: {report.dateRangeExamined.from} → {report.dateRangeExamined.to}
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
      {report.analysisInput && report.analysisInput.length > 0 && (
        <>
          <h4>Analysis input</h4>
          <ul>
            {report.analysisInput.map((item) => (
              <li key={item.postId}>
                {item.postId}: {item.disposition} ({item.reason}, {item.originalChars} to{" "}
                {item.sentChars} characters)
              </li>
            ))}
          </ul>
        </>
      )}
      {usageText(report.providerUsage, report.modelInvoked) && (
        <p>{usageText(report.providerUsage, report.modelInvoked)}</p>
      )}
    </article>
  );
}

export function App() {
  const [metaState, setMetaState] = useState<MetaState>({ status: "loading" });
  const [handles, setHandles] = useState(DEFAULT_HANDLES.join(","));
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [fresh, setFresh] = useState(false);
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
        if (!cancelled) {
          setMetaState({ status: "ok", meta });
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setRun({ status: "loading" });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fresh ? { handles, question, fresh: true } : { handles, question }),
      });
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

  const status =
    run.status === "ok"
      ? statusLines(run.result)
      : run.status === "error"
        ? statusLines({ invalidHandles: run.invalidHandles, fetchOutcomes: [] })
        : [];
  const meta = metaState.status === "ok" ? metaState.meta : null;
  const mockLabels =
    !meta || (meta.postsSource === "fixtures" && meta.analysisSource === "mock-rules" && meta.demo);

  return (
    <div className="app">
      <header className="demo-banner" role="status">
        {mockLabels ? (
          <>
            <p className="demo-banner__title">
              Demo mode — fixture posts only; no live API or LLM
            </p>
            <p className="demo-banner__sub">
              This web preview uses local mock data. It does not call Desearch, X, or
              any paid service.
            </p>
          </>
        ) : (
          <>
            <p className="demo-banner__title">
              Posts source: {meta?.postsSource}. Analysis source: {meta?.analysisSource}.
            </p>
            <p className="demo-banner__sub">{meta?.description}</p>
          </>
        )}
      </header>

      <main className="main">
        <h1 className="title">{mockLabels ? "x-analyst (mock)" : "x-analyst"}</h1>
        <p className="lede">
          {mockLabels
            ? "Enter handles and a question. The report uses fixture posts and fixed keyword rules."
            : "Enter handles and a question. Labels follow the configured post source and analysis source."}
        </p>

        <form className="analyze-form" aria-label="Analyze analysts" onSubmit={onSubmit}>
          <label className="analyze-form__field" htmlFor="handles">
            Handles
            <input
              id="handles"
              name="handles"
              value={handles}
              onChange={(event) => setHandles(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="analyze-form__field" htmlFor="question">
            Question
            <textarea
              id="question"
              name="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
            />
          </label>
          <p className="analyze-form__note" id="question-note">
            {meta?.analysisSource === "chutes"
              ? "The question is sent to the model and must be at most 500 characters."
              : "The mock analyzer uses fixed keyword rules. Changing the question does not change its analysis."}
          </p>
          <label className="analyze-form__field" htmlFor="fresh">
            <input
              id="fresh"
              name="fresh"
              type="checkbox"
              checked={fresh}
              onChange={(event) => setFresh(event.target.checked)}
            />
            Fetch a new slice
          </label>
          <p className="analyze-form__note">
            Unchecked reuses a matching slice already fetched by this server process.
            Checked fetches again. A reused slice is not a new fetch. Analysis can
            still run again.
          </p>
          <button type="submit" disabled={run.status === "loading"}>
            {run.status === "loading" ? "Analyzing…" : "Analyze"}
          </button>
        </form>

        <section className="results" aria-live="polite" aria-label="Analysis results">
          {run.status === "loading" && <p className="results__loading">Analyzing…</p>}
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
              <p>
                Posts source: {run.result.postsSource}. Analysis source: {run.result.analysisSource}.
                Analysis reference date: {run.result.referenceDate}.
              </p>
              <p>
                {run.result.reused ? "Reused an earlier slice." : "Fetched a new slice."} Fetched at{" "}
                {run.result.fetchedAt}.
              </p>
              {run.result.billing.map((item, index) => (
                <p key={`billing-${index}`}>{billingText(item)}</p>
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
                <dt>Posts source</dt>
                <dd>{metaState.meta.postsSource}</dd>
              </div>
              <div>
                <dt>Analysis</dt>
                <dd>{metaState.meta.analysisSource}</dd>
              </div>
              <div>
                <dt>Live API</dt>
                <dd>
                  {metaState.meta.liveApiEnabled ? "enabled" : "disabled"}
                </dd>
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
