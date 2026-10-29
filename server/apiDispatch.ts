import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChutesTransport } from "../src/analyze/chutesClient.js";
import type { DesearchTransport } from "../src/fetch/desearch/desearchTransport.js";
import type { FetchSliceCache } from "../src/runtime/fetchCache.js";
import { createFetchSliceCache } from "../src/runtime/fetchCache.js";
import {
  ReportPathError,
  listReportBasenames,
  readReportJson,
} from "./reportsStorage.js";

const JSON_CONTENT = "application/json; charset=utf-8";

export interface MetaResponse {
  mode: "viewer";
  demo: boolean;
  description: string;
  liveApiEnabled: false;
}

export interface ApiDeps {
  env?: NodeJS.ProcessEnv;
  cache?: FetchSliceCache;
  desearchTransport?: DesearchTransport;
  chutesTransport?: ChutesTransport;
}

/** Report viewer metadata. Does not call Desearch or Chutes. */
export function buildMetaResponse(): MetaResponse {
  return {
    mode: "viewer",
    demo: true,
    description:
      "Saved report viewer only. Run npm run analyze locally, then open a JSON report from data/reports/. This UI never starts a live fetch or model call.",
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

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  _deps: ApiDeps = {},
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (method === "GET" && url.pathname === "/api/meta") {
    sendJson(res, 200, buildMetaResponse());
    return;
  }

  if (method === "GET" && url.pathname === "/api/reports") {
    sendJson(res, 200, { reports: listReportBasenames() });
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/api/reports/")) {
    let basename: string;
    try {
      basename = decodeURIComponent(url.pathname.slice("/api/reports/".length));
    } catch {
      sendJson(res, 400, { error: "Malformed report path" });
      return;
    }
    try {
      sendJson(res, 200, readReportJson(basename));
    } catch (err) {
      if (err instanceof ReportPathError) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      const code =
        err !== null && typeof err === "object" && "code" in err
          ? (err as { code?: string }).code
          : undefined;
      if (code === "ENOENT") {
        sendJson(res, 404, { error: "Report not found" });
        return;
      }
      sendJson(res, 500, { error: "Could not read report" });
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/analyze") {
    sendJson(res, 405, {
      error: "Live analysis was removed from the web UI. Run npm run analyze locally.",
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function isolatedMockEnvForTests(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    POSTS_PROVIDER: "mock",
    ANALYSIS_PROVIDER: "mock",
    LLM_LIVE_ENABLED: "false",
    DESEARCH_LIVE_ENABLED: "false",
    CHUTES_API_KEY: "",
    DESEARCH_API_KEY: "",
  };
  const sliceDir = process.env.X_ANALYST_SLICE_DIR?.trim();
  if (sliceDir !== undefined && sliceDir !== "") {
    env.X_ANALYST_SLICE_DIR = sliceDir;
  }
  const reportsDir = process.env.X_ANALYST_REPORTS_DIR?.trim();
  if (reportsDir !== undefined && reportsDir !== "") {
    env.X_ANALYST_REPORTS_DIR = reportsDir;
  }
  return env;
}

export async function dispatchApiForTest(input: {
  method: string;
  pathname: string;
  body?: string;
  env?: NodeJS.ProcessEnv;
  cache?: FetchSliceCache;
  desearchTransport?: DesearchTransport;
  chutesTransport?: ChutesTransport;
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

  await handleApiRequest(mockReq, mockRes, {
    env: input.env ?? isolatedMockEnvForTests(),
    cache: input.cache ?? createFetchSliceCache(),
    desearchTransport: input.desearchTransport,
    chutesTransport: input.chutesTransport,
  });
  return { statusCode, body: responseBody };
}
