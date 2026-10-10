import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChutesTransport } from "../src/analyze/chutesClient.js";
import { loadDesearchSettings } from "../src/config/desearchSettings.js";
import {
  loadLlmRuntimeConfig,
  utcReferenceDate,
} from "../src/config/llmSettings.js";
import { loadPostsProviderConfig } from "../src/config/postsProvider.js";
import type { DesearchTransport } from "../src/fetch/desearch/desearchTransport.js";
import type { FetchSliceCache } from "../src/runtime/fetchCache.js";
import { createFetchSliceCache } from "../src/runtime/fetchCache.js";
import { ReportConfigError, ReportRunError, runReport } from "../src/runReport.js";
import type { AnalysisProviderLabel, PostSource } from "../src/types.js";
import { parseHandleList } from "../src/validation/handles.js";

const JSON_CONTENT = "application/json; charset=utf-8";

export interface MetaResponse {
  mode: "mock" | "live";
  demo: boolean;
  description: string;
  postsSource: PostSource;
  analysisSource: AnalysisProviderLabel;
  liveApiEnabled: boolean;
}

export interface ApiDeps {
  env?: NodeJS.ProcessEnv;
  cache?: FetchSliceCache;
  desearchTransport?: DesearchTransport;
  chutesTransport?: ChutesTransport;
}

/** Reads gates only. Does not call Desearch or Chutes. */
export function buildMetaResponse(
  env: NodeJS.ProcessEnv = process.env,
): MetaResponse {
  const postsSelected = loadPostsProviderConfig(env).provider;
  const desearch = loadDesearchSettings(env);
  const llm = loadLlmRuntimeConfig(env);
  const postsSource: PostSource = postsSelected === "desearch" ? "desearch" : "fixtures";
  const analysisSource: AnalysisProviderLabel =
    llm.provider === "chutes" ? "chutes" : "mock-rules";
  const postsReady = postsSource === "fixtures" || desearch.liveEligible;
  const notes: string[] = [];
  if (!postsReady) {
    notes.push(
      "Desearch is selected but not fully enabled. No Desearch request will be made.",
    );
  }
  if (llm.provider === "chutes" && !llm.eligible) {
    notes.push(`${llm.reason ?? "Chutes is not fully enabled."} No model request will be made.`);
  }
  if (llm.provider !== "" && llm.provider !== "mock" && llm.provider !== "chutes") {
    notes.push("ANALYSIS_PROVIDER is not supported. No model request will be made.");
  }
  const demo =
    postsSource === "fixtures" && analysisSource === "mock-rules" && notes.length === 0;
  const livePosts = postsSource === "desearch" && desearch.liveEligible;
  const liveAnalysis = analysisSource === "chutes" && llm.eligible;
  const description = demo
    ? "Fixture posts and rule-based mock analysis only. No live Desearch, X, or LLM."
    : [
        `Posts source: ${postsSource}. Analysis source: ${analysisSource}.`,
        ...notes,
        "Loading this description does not call Desearch or Chutes.",
      ].join(" ");
  return {
    mode: livePosts || liveAnalysis ? "live" : "mock",
    demo,
    description,
    postsSource,
    analysisSource,
    liveApiEnabled: livePosts || liveAnalysis,
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
  fresh?: unknown;
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (method === "GET" && url.pathname === "/api/meta") {
    sendJson(res, 200, buildMetaResponse(env));
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

    if (parsed.fresh !== undefined && typeof parsed.fresh !== "boolean") {
      sendJson(res, 400, { error: "fresh must be a boolean" });
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
      const result = await runReport(
        valid,
        { text: question },
        {
          referenceDate: utcReferenceDate(),
          fresh: parsed.fresh === true,
          env,
          cache: deps.cache,
          desearchTransport: deps.desearchTransport,
          chutesTransport: deps.chutesTransport,
        },
      );
      const mode =
        result.postsSource === "fixtures" && result.analysisSource === "mock-rules"
          ? "mock"
          : "live";
      sendJson(res, 200, {
        mode,
        question,
        postsSource: result.postsSource,
        analysisSource: result.analysisSource,
        referenceDate: result.referenceDate,
        fetchedAt: result.fetchedAt,
        reused: result.reused,
        billing: result.billing,
        invalidHandles,
        fetchOutcomes: result.fetchOutcomes,
        reports: result.reports,
      });
    } catch (err) {
      if (err instanceof ReportConfigError) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      if (err instanceof ReportRunError) {
        sendJson(res, 502, {
          error: err.message,
          postsSource: err.details.postsSource,
          analysisSource: err.details.analysisSource,
          referenceDate: err.details.referenceDate,
          fetchedAt: err.details.fetchedAt,
          reused: err.details.reused,
          billing: err.details.billing,
          providerUsages: err.details.providerUsages,
          sliceStored: err.details.sliceStored,
        });
        return;
      }
      sendJson(res, 500, { error: "Analysis failed unexpectedly" });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

/** Test helper: dispatch without binding a port or external network. */
const isolatedMockEnv: NodeJS.ProcessEnv = {
  POSTS_PROVIDER: "mock",
  ANALYSIS_PROVIDER: "mock",
  LLM_LIVE_ENABLED: "false",
  DESEARCH_LIVE_ENABLED: "false",
  CHUTES_API_KEY: "",
  DESEARCH_API_KEY: "",
};

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
    env: input.env ?? isolatedMockEnv,
    cache: input.cache ?? createFetchSliceCache(),
    desearchTransport: input.desearchTransport,
    chutesTransport: input.chutesTransport,
  });
  return { statusCode, body: responseBody };
}
