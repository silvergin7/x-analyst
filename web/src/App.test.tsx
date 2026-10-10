import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUESTION } from "../../src/config";
import { App } from "./App";

const metaBody = {
  mode: "mock",
  demo: true,
  description: "Fixture posts and rule-based mock analysis only.",
  postsSource: "fixtures",
  analysisSource: "mock-rules",
  liveApiEnabled: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(
  onAnalyze: (init?: RequestInit) => Promise<Response> | Response,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/meta")) {
      return jsonResponse(200, metaBody);
    }
    if (url.includes("/api/analyze")) {
      return onAnalyze(init);
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
    mode: "mock",
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
    ...extras,
  };
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mock analyze form", () => {
  it("starts from the documented question and shows a successful report", async () => {
    const user = userEvent.setup();
    installFetch(() =>
      jsonResponse(
        200,
        successBody(
          [evidenceReport],
          [{ status: "ok", handle: "bullmacro", posts: [], retrievalComplete: true }],
        ),
      ),
    );
    render(<App />);

    const question = await screen.findByLabelText("Question");
    expect((question as HTMLTextAreaElement).value).toBe(DEFAULT_QUESTION);
    expect(
      screen.getByText(
        "The mock analyzer uses fixed keyword rules. Changing the question does not change its analysis.",
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Analyze" }));

    const card = await screen.findByRole("article", { name: "@bullmacro" });
    expect(card.textContent).toContain("Outlook: bullish");
    expect(card.textContent).toContain(evidenceReport.explanation);
    expect(card.textContent).toContain("Posts examined: 3");
    expect(card.textContent).toContain(
      "Date range of retrieved slice: 2026-09-18T09:30:00.000Z → 2026-09-20T14:00:00.000Z",
    );
    expect(card.textContent).toContain("Retrieval coverage: complete");
    expect(card.textContent).toContain("Fictional fixture link, not a live X link");
    expect(card.textContent).toContain("Author: bullmacro");
    expect(card.textContent).toContain("Timestamp: 2026-09-20T14:00:00.000Z");
    expect(card.textContent).toContain("Post ID: b1");
    expect(card.textContent).toContain("Kind: original");
    expect(screen.getByRole("link", { name: evidenceReport.evidence[0]!.url }).getAttribute("href")).toBe(
      evidenceReport.evidence[0]!.url,
    );
    expect(screen.getByText("Mode")).toBeTruthy();
  });

  it("keeps an unclear report and states missing evidence and dates", async () => {
    const user = userEvent.setup();
    installFetch(() =>
      jsonResponse(
        200,
        successBody([
          {
            handle: "unclearmacro",
            outlook: "unclear",
            explanation: "Insufficient original commentary.",
            dateRangeExamined: null,
            postsExamined: 3,
            retrievalComplete: true,
            evidence: [],
            analysisSource: "mock",
          },
        ]),
      ),
    );
    render(<App />);
    await screen.findByRole("button", { name: "Analyze" });
    await user.click(screen.getByRole("button", { name: "Analyze" }));

    const card = await screen.findByRole("article", { name: "@unclearmacro" });
    expect(card.textContent).toContain("Outlook: unclear");
    expect(card.textContent).toContain("No supporting evidence in the examined slice.");
    expect(card.textContent).toContain("No date range was returned for this report.");
  });

  it("shows status lines without outlook cards, and does not repeat an invalid handle", async () => {
    const user = userEvent.setup();
    installFetch(() =>
      jsonResponse(
        200,
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
      ),
    );
    render(<App />);
    await screen.findByRole("button", { name: "Analyze" });
    await user.click(screen.getByRole("button", { name: "Analyze" }));

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
    const user = userEvent.setup();
    installFetch(() =>
      jsonResponse(
        200,
        successBody([
          {
            ...evidenceReport,
            retrievalComplete: false,
            retrievalIncompleteReason: "per_person_limit_reached",
            postsExamined: 1,
          },
        ]),
      ),
    );
    render(<App />);
    await screen.findByRole("button", { name: "Analyze" });
    await user.click(screen.getByRole("button", { name: "Analyze" }));

    const card = await screen.findByRole("article", { name: "@bullmacro" });
    expect(card.textContent).toContain("Partial retrieval: per_person_limit_reached");
    expect(card.textContent).toContain("Outlook: bullish");
  });

  it("sends one analyze request while a submission is pending", async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = installFetch(() => pending);
    render(<App />);
    const button = await screen.findByRole("button", { name: "Analyze" });
    await user.click(button);
    const results = screen.getByRole("region", { name: "Analysis results" });
    expect(results.textContent).toContain("Analyzing…");
    expect(button.hasAttribute("disabled")).toBe(true);
    await user.click(button);
    const analyzeCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/analyze"),
    );
    expect(analyzeCalls).toHaveLength(1);
    expect(screen.queryByRole("article")).toBeNull();
    release(jsonResponse(200, successBody([evidenceReport])));
    expect(await screen.findByRole("article", { name: "@bullmacro" })).toBeTruthy();
  });

  it("clears a previous report when a later request returns an HTTP error", async () => {
    const user = userEvent.setup();
    let calls = 0;
    installFetch(() => {
      calls += 1;
      if (calls === 1) return jsonResponse(200, successBody([evidenceReport]));
      return jsonResponse(400, { error: "Question is required and cannot be empty" });
    });
    render(<App />);
    const button = await screen.findByRole("button", { name: "Analyze" });
    await user.click(button);
    expect(await screen.findByRole("article", { name: "@bullmacro" })).toBeTruthy();

    await user.clear(screen.getByLabelText("Question"));
    await user.click(button);
    expect(
      await screen.findByRole("alert"),
    ).toHaveProperty("textContent", "Question is required and cannot be empty");
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("clears a previous report when the network request is rejected", async () => {
    const user = userEvent.setup();
    let calls = 0;
    installFetch(() => {
      calls += 1;
      if (calls === 1) return jsonResponse(200, successBody([evidenceReport]));
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    render(<App />);
    const button = await screen.findByRole("button", { name: "Analyze" });
    await user.click(button);
    expect(await screen.findByRole("article", { name: "@bullmacro" })).toBeTruthy();
    await user.click(button);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Could not reach the local API")).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("posts the edited handles and question as JSON", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(() => jsonResponse(200, successBody([evidenceReport])));
    render(<App />);
    const handles = await screen.findByLabelText("Handles");
    const question = screen.getByLabelText("Question");
    await user.clear(handles);
    await user.type(handles, "editedmacro");
    await user.clear(question);
    await user.type(question, "Edited question");
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByRole("article", { name: "@bullmacro" });

    const analyzeCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/analyze"),
    );
    expect(analyzeCalls).toHaveLength(1);
    const init = analyzeCalls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      handles: "editedmacro",
      question: "Edited question",
    });
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
  ])("rejects a success response with a %s", async (_label, report) => {
    const user = userEvent.setup();
    installFetch(() => jsonResponse(200, successBody([report])));
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Analyze" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "API returned an unexpected response",
    );
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("rejects an unknown outcome status instead of showing an unexamined line", async () => {
    const user = userEvent.setup();
    installFetch(() =>
      jsonResponse(
        200,
        successBody([evidenceReport], [{ status: "banned", handle: "someone" }]),
      ),
    );
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Analyze" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "API returned an unexpected response",
    );
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByText(/was not examined/)).toBeNull();
  });

  it("rejects the whole success response when one invalid-handle entry is malformed", async () => {
    const user = userEvent.setup();
    installFetch(() =>
      jsonResponse(200, successBody([evidenceReport], [], [{ raw: "bad handle" }])),
    );
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Analyze" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "API returned an unexpected response",
    );
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByText(/bad handle/)).toBeNull();
  });

  it("labels retrieved posts without the fixture warning and shows reuse", async () => {
    const user = userEvent.setup();
    let calls = 0;
    installFetch(() => {
      calls += 1;
      return jsonResponse(
        200,
        successBody(
          [
            {
              ...evidenceReport,
              evidence: [
                {
                  ...evidenceReport.evidence[0],
                  url: "https://x.com/example/status/1",
                },
              ],
              analysisInput: [
                {
                  postId: "b3",
                  disposition: "excluded",
                  reason: "quote_without_analyst_commentary",
                  originalChars: 0,
                  sentChars: 0,
                },
              ],
              providerUsage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
              modelInvoked: true,
            },
          ],
          [],
          [],
          {
            postsSource: "desearch",
            analysisSource: "chutes",
            reused: calls > 1,
            billing: [{ usageCount: 10 }],
          },
        ),
      );
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Analyze" }));
    const card = await screen.findByRole("article", { name: "@bullmacro" });
    expect(card.textContent).toContain("Retrieved post link");
    expect(card.textContent).not.toContain("Fictional fixture link");
    expect(card.textContent).toContain("quote_without_analyst_commentary");
    expect(card.textContent).toContain("prompt_tokens=5");
    expect(screen.getByText(/Fetched a new slice/)).toBeTruthy();
    expect(screen.getByText(/Desearch usage count 10/)).toBeTruthy();
    expect(screen.queryByText(/Desearch reported cost/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText(/Reused an earlier slice/)).toBeTruthy();
  });

  it("sends fresh only when the new-slice control is checked", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(() => jsonResponse(200, successBody([evidenceReport])));
    render(<App />);
    await user.click(await screen.findByRole("checkbox", { name: "Fetch a new slice" }));
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByRole("article", { name: "@bullmacro" });
    const analyzeCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/analyze"),
    );
    expect(JSON.parse(String(analyzeCalls[0]?.[1]?.body))).toMatchObject({ fresh: true });
  });

  it("shows billing and every model usage on a failed run without an outlook card", async () => {
    const user = userEvent.setup();
    installFetch(() =>
      jsonResponse(502, {
        error: "Chutes refused the request",
        postsSource: "desearch",
        analysisSource: "chutes",
        referenceDate: "2026-11-02",
        fetchedAt: "2026-11-02T12:00:00.000Z",
        reused: false,
        sliceStored: true,
        billing: [{ usageCount: 3 }, { usageCount: 4 }],
        providerUsages: [
          { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
          { promptTokens: 9, completionTokens: 1, totalTokens: 10 },
        ],
      }),
    );
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Analyze" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Chutes refused the request");
    expect(screen.getByText("The run failed. No complete report was produced.")).toBeTruthy();
    expect(screen.getByText(/prompt_tokens=11/)).toBeTruthy();
    expect(screen.getByText(/prompt_tokens=9/)).toBeTruthy();
    expect(screen.getByText(/Desearch usage count 3/)).toBeTruthy();
    expect(screen.getByText(/Desearch usage count 4/)).toBeTruthy();
    expect(screen.getByText(/Fetched a new slice/)).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });
});
