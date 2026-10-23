import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUESTION } from "../../src/config";
import { App } from "./App";

const metaBody = {
  mode: "viewer",
  demo: true,
  description: "Saved report viewer only.",
  liveApiEnabled: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(reportBody?: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/meta")) {
      return jsonResponse(200, metaBody);
    }
    if (url.includes("/api/analyze")) {
      throw new Error("POST /api/analyze must not be called from the viewer");
    }
    if (url.includes("/api/reports") && !url.endsWith("/api/reports")) {
      return jsonResponse(200, reportBody ?? {});
    }
    if (url.endsWith("/api/reports")) {
      return jsonResponse(200, { reports: [] });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const evidenceReport = {
  handle: "bullmacro",
  outlook: "bullish",
  explanation: "Mock analysis (not LLM): dominant signal is bullish.",
  dateRangeExamined: {
    from: "2026-09-18T09:30:00.000Z",
    to: "2026-09-20T14:00:00.000Z",
  },
  postsExamined: 3,
  retrievalComplete: true,
  evidence: [
    {
      postId: "b1",
      url: "https://fixture.x-analyst.local/posts/bullmacro/b1",
      timestamp: "2026-09-20T14:00:00.000Z",
      kind: "original",
    },
  ],
  analysisSource: "mock",
};

function successBody(
  reports: unknown[],
  fetchOutcomes: unknown[] = [],
  invalidHandles: unknown[] = [],
  extras: Record<string, unknown> = {},
) {
  return {
    question: DEFAULT_QUESTION,
    postsSource: "fixtures",
    analysisSource: "mock-rules",
    referenceDate: "2026-10-09",
    fetchedAt: "2026-10-09T12:00:00.000Z",
    reused: false,
    billing: [],
    invalidHandles,
    fetchOutcomes,
    reports,
    handleFailures: [],
    ...extras,
  };
}

async function uploadReport(body: unknown) {
  render(<App />);
  await screen.findByText(/Saved report viewer/);
  const json = JSON.stringify(body);
  const file = new File([json], "report.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    value: async () => json,
  });
  const input = document.getElementById("report-upload");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("report upload input missing");
  }
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("report viewer", () => {
  it("never calls POST /api/analyze", async () => {
    const fetchMock = installFetch();
    await uploadReport(
      successBody(
        [evidenceReport],
        [{ status: "ok", handle: "bullmacro" }],
      ),
    );
    expect(await screen.findByText(/Outlook: bullish/)).toBeTruthy();
    const analyzeCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/analyze"),
    );
    expect(analyzeCalls).toHaveLength(0);
  });

  it("shows status lines without outlook cards, and does not repeat an invalid handle", async () => {
    installFetch();
    await uploadReport(
      successBody(
        [],
        [
          {
            status: "invalid_handle",
            handle: "bad handle",
            reason: "handle must contain only letters, numbers, and underscore",
          },
          { status: "unknown_handle", handle: "notahandle" },
          { status: "empty", handle: "emptymacro" },
          {
            status: "incomplete",
            handle: "bearmacro",
            reason: "total_post_limit_reached",
          },
        ],
        [
          {
            raw: "bad handle",
            reason: "handle must contain only letters, numbers, and underscore",
          },
        ],
      ),
    );
    expect(
      await screen.findByText(
        'Invalid handle "bad handle": handle must contain only letters, numbers, and underscore',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText(/bad handle/)).toHaveLength(1);
    expect(
      screen.getByText('Unknown handle "notahandle" (not in the fixture catalog)'),
    ).toBeTruthy();
    expect(screen.getByText('No posts for "emptymacro" in the fixtures')).toBeTruthy();
    expect(
      screen.getByText(
        "@bearmacro was not examined (total_post_limit_reached). No outlook was inferred.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("labels partial retrieval on the report card", async () => {
    installFetch();
    await uploadReport(
      successBody([
        {
          ...evidenceReport,
          retrievalComplete: false,
          retrievalIncompleteReason: "per_person_limit_reached",
          postsExamined: 1,
        },
      ]),
    );
    const card = await screen.findByRole("article");
    expect(card.textContent).toContain("Partial retrieval: per_person_limit_reached");
    expect(card.textContent).toContain("Outlook: bullish");
  });

  it("shows sent excerpts, quoted text, and a stale relevant post", async () => {
    installFetch();
    await uploadReport(
      successBody([
        {
          ...evidenceReport,
          eligiblePostCount: 2,
          relevantPostCount: 1,
          newestRelevantPostAt: "2026-09-01T00:00:00.000Z",
          viewMayBeStale: true,
          fetchStopReason: "lookback_window_reached",
          analysisInput: [
            {
              postId: "q1",
              timestamp: "2026-09-01T00:00:00.000Z",
              disposition: "sent",
              reason: "quote_commentary",
              originalChars: 120,
              sentChars: 120,
              sentExcerpt: "Duration still looks attractive if growth cools.",
              quotedPostExcerpt: "Quoted account says something else entirely.",
            },
          ],
        },
      ]),
    );
    const card = await screen.findByRole("article");
    expect(card.textContent).toContain("Relevant posts: 1 of 2 eligible");
    expect(card.textContent).toContain("Newest relevant post: 2026-09-01T00:00:00.000Z");
    expect(card.textContent).toContain(
      "The newest relevant post is older than 14 days. The view may be stale.",
    );
    expect(card.textContent).toContain("Fetch stopped: oldest post is past the lookback window");
    expect(card.textContent).toContain("Sent text: Duration still looks attractive if growth cools.");
    expect(card.textContent).toContain(
      "Quoted post text: Quoted account says something else entirely.",
    );
  });

  it.each([
    ["unsupported outlook", { ...evidenceReport, outlook: "sideways" }],
    [
      "unsupported evidence kind",
      {
        ...evidenceReport,
        evidence: [{ ...evidenceReport.evidence[0], kind: "thread" }],
      },
    ],
    ["malformed date range", { ...evidenceReport, dateRangeExamined: { from: 1 } }],
    ["non-boolean retrieval flag", { ...evidenceReport, retrievalComplete: "yes" }],
  ])("rejects an uploaded report with a %s", async (_label, report) => {
    installFetch();
    await uploadReport(successBody([report]));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "The selected file is not a saved report",
    );
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("rejects an unknown outcome status instead of showing an unexamined line", async () => {
    installFetch();
    await uploadReport(
      successBody([evidenceReport], [{ status: "banned", handle: "someone" }]),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "The selected file is not a saved report",
    );
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByText(/was not examined/)).toBeNull();
  });

  it("rejects the whole upload when one invalid-handle entry is malformed", async () => {
    installFetch();
    await uploadReport(successBody([evidenceReport], [], [{ raw: "bad handle" }]));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "The selected file is not a saved report",
    );
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByText(/bad handle/)).toBeNull();
  });

  it("shows handleFailures with local estimate and provider usage kept separate", async () => {
    installFetch();
    await uploadReport(
      successBody([], [{ status: "ok", handle: "bullmacro" }], [], {
        handleFailures: [
          {
            handle: "bullmacro",
            message: "Chutes refused the request",
            budgetEstimate: { estimatedUsd: 0.012345 },
            providerUsage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
          },
        ],
      }),
    );
    expect(await screen.findByText(/Local estimate \$0.012345 \(not provider usage\)/)).toBeTruthy();
    expect(screen.getByText(/Provider usage prompt_tokens=11/)).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("shows billing lines on a saved report", async () => {
    installFetch();
    await uploadReport(
      successBody([evidenceReport], [{ status: "ok", handle: "bullmacro" }], [], {
        postsSource: "desearch",
        analysisSource: "chutes",
        billing: [{ usageCount: 10 }, { costUsd: 0.02, usageCount: 3 }],
      }),
    );
    expect(await screen.findByText(/Desearch usage count 10/)).toBeTruthy();
    expect(screen.getByText(/Desearch reported cost USD 0.02/)).toBeTruthy();
    expect(screen.getByText(/Desearch usage count 3/)).toBeTruthy();
  });
});
