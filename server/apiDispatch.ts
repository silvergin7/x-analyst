import type { IncomingMessage, ServerResponse } from "node:http";
import { parseHandleList } from "../src/validation/handles.js";
import { runReport } from "../src/runReport.js";

const JSON_CONTENT = "application/json; charset=utf-8";

export interface MetaResponse {
  mode: "mock";
  demo: true;
  description: string;
  postsSource: "fixtures";
  analysisSource: "mock-rules";
  liveApiEnabled: false;
}

export function buildMetaResponse(): MetaResponse {
  return {
    mode: "mock",
    demo: true,
    description:
      "Fixture posts and rule-based mock analysis only. No live Desearch, X, or LLM.",
    postsSource: "fixtures",
    analysisSource: "mock-rules",
    liveApiEnabled: false,
  };
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", JSON_CONTENT);
  res.end(JSON.stringify(payload));
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export interface AnalyzeRequestBody {
  handles?: unknown;
  question?: unknown;
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (method === "GET" && url.pathname === "/api/meta") {
    sendJson(res, 200, buildMetaResponse());
    return;
  }

  if (method === "POST" && url.pathname === "/api/analyze") {
    let rawBody: string;
    try {
      rawBody = await readRequestBody(req);
    } catch {
      sendJson(res, 500, { error: "Failed to read request body" });
      return;
    }

    let parsed: AnalyzeRequestBody;
    try {
      parsed = JSON.parse(rawBody) as AnalyzeRequestBody;
    } catch {
      sendJson(res, 400, { error: "Request body must be valid JSON" });
      return;
    }

    const handlesRaw =
      typeof parsed.handles === "string" ? parsed.handles : "";
    const questionRaw =
      typeof parsed.question === "string" ? parsed.question : "";
    const question = questionRaw.trim();

    if (question.length === 0) {
      sendJson(res, 400, { error: "Question is required and cannot be empty" });
      return;
    }

    const { valid, invalid: invalidHandles } = parseHandleList(handlesRaw);
    if (valid.length === 0) {
      sendJson(res, 400, {
        error: "At least one valid handle is required",
        invalidHandles,
      });
      return;
    }

    try {
      const { fetchOutcomes, reports } = await runReport(valid, {
        text: question,
      });
      sendJson(res, 200, {
        mode: "mock" as const,
        question,
        invalidHandles,
        fetchOutcomes,
        reports,
      });
    } catch {
      sendJson(res, 500, { error: "Analysis failed unexpectedly" });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

/** Test helper: dispatch without binding a port or external network. */
export async function dispatchApiForTest(input: {
  method: string;
  pathname: string;
  body?: string;
}): Promise<{ statusCode: number; body: string }> {
  const mockReq = {
    method: input.method,
    url: input.pathname,
    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === "data" && input.body !== undefined) {
        listener(Buffer.from(input.body, "utf8"));
      }
      if (event === "end") {
        listener(undefined);
      }
      return mockReq;
    },
  } as unknown as IncomingMessage;

  let statusCode = 200;
  let responseBody = "";

  const mockRes = {
    setHeader() {
      return mockRes;
    },
    end(data?: string) {
      if (data !== undefined) responseBody = data;
    },
  } as unknown as ServerResponse;

  Object.defineProperty(mockRes, "statusCode", {
    get() {
      return statusCode;
    },
    set(v: number) {
      statusCode = v;
    },
  });

  await handleApiRequest(mockReq, mockRes);
  return { statusCode, body: responseBody };
}
