import { useEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_HANDLES, DEFAULT_QUESTION } from "../../src/config";

interface MetaResponse {
  mode: "mock";
  demo: true;
  description: string;
  postsSource: string;
  analysisSource: string;
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

interface OutlookReport {
  handle: string;
  outlook: string;
  explanation: string;
  dateRangeExamined: { from: string; to: string } | null;
  postsExamined: number;
  retrievalComplete: boolean;
  retrievalIncompleteReason?: string;
  evidence: EvidenceItem[];
}

type FetchOutcome =
  | { status: "ok"; handle: string }
  | { status: "incomplete"; handle: string; reason: string }
  | { status: "unknown_handle"; handle: string }
  | { status: "invalid_handle"; handle: string; reason: string }
  | { status: "empty"; handle: string };

interface AnalyzeSuccess {
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
  | { status: "error"; message: string; invalidHandles: InvalidHandle[] }
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
  return {
    handle: value.handle,
    outlook: value.outlook,
    explanation: value.explanation,
    dateRangeExamined,
    postsExamined: value.postsExamined,
    retrievalComplete: value.retrievalComplete,
    retrievalIncompleteReason: value.retrievalIncompleteReason,
    evidence,
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
  return { invalidHandles, fetchOutcomes, reports };
}

function sameInvalid(raw: string, handle: string): boolean {
  return raw.trim().toLowerCase() === handle.trim().toLowerCase();
}

export function statusLines(input: {
  invalidHandles: InvalidHandle[];
  fetchOutcomes: FetchOutcome[];
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
        text: `Unknown handle "${outcome.handle}" (not in the fixture catalog)`,
      });
      return;
    }
    if (outcome.status === "empty") {
      lines.push({
        key: `empty-${index}-${outcome.handle}`,
        text: `No posts for "${outcome.handle}" in the fixtures`,
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

function ReportCard({ report }: { report: OutlookReport }) {
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
                Fictional fixture link, not a live X link
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
    </article>
  );
}

export function App() {
  const [metaState, setMetaState] = useState<MetaState>({ status: "loading" });
  const [handles, setHandles] = useState(DEFAULT_HANDLES.join(","));
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
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
        body: JSON.stringify({ handles, question }),
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
        if (mounted.current) {
          setRun({
            status: "error",
            message,
            invalidHandles:
              readInvalidHandles(
                isRecord(payload) ? payload.invalidHandles : undefined,
              ) ?? [],
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

  return (
    <div className="app">
      <header className="demo-banner" role="status">
        <p className="demo-banner__title">
          Demo mode — fixture posts only; no live API or LLM
        </p>
        <p className="demo-banner__sub">
          This web preview uses local mock data. It does not call Desearch, X, or
          any paid service.
        </p>
      </header>

      <main className="main">
        <h1 className="title">x-analyst (mock)</h1>
        <p className="lede">
          Enter handles and a question. The report uses fixture posts and fixed
          keyword rules.
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
            The mock analyzer uses fixed keyword rules. Changing the question
            does not change its analysis.
          </p>
          <button type="submit" disabled={run.status === "loading"}>
            {run.status === "loading" ? "Analyzing…" : "Analyze"}
          </button>
        </form>

        <section className="results" aria-live="polite" aria-label="Analysis results">
          {run.status === "loading" && <p className="results__loading">Analyzing…</p>}
          {run.status === "error" && (
            <p className="form-error" role="alert">
              {run.message}
            </p>
          )}
          <StatusList lines={status} />
          {run.status === "ok" &&
            run.result.reports.map((report) => (
              <ReportCard key={report.handle} report={report} />
            ))}
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
