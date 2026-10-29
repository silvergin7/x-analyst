import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createFetchChutesTransport,
  LlmCallError,
  requestChutesCompletion,
  type ChutesTransport,
} from "../src/analyze/chutesClient.js";
import type { LlmRuntimeConfig } from "../src/config/llmSettings.js";
import { testLlmRuntimeFields, withTestChutesModelEnv } from "./support/chutesTestModel.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";

const CLIENT_TIMEOUT_MS = 200;
const LATE_HOLD_MS = 8_000;
const LATE_BOUND_MS = 4_000;

function config(chatCompletionsUrl: string): LlmRuntimeConfig {
  return {
    provider: "chutes",
    liveEnabled: true,
    apiKey: "test-key",
    chatCompletionsUrl,
    eligible: true,
    ...testLlmRuntimeFields(),
  };
}

function completionBody(content: string): string {
  return JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function causeCode(err: unknown): string | undefined {
  const seen = new Set<object>();
  let current: unknown = err;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

interface HeldServer {
  url: string;
  close: () => Promise<void>;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("test server has no port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function holdServer(mode: "headers" | "body", holdMs: number, body: string): Promise<HeldServer> {
  const timers = new Set<NodeJS.Timeout>();
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    req.resume();
    if (mode === "body") {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      });
      res.flushHeaders();
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (mode === "headers") {
        res.writeHead(200, { "content-type": "application/json" });
      }
      res.end(body);
    }, holdMs);
    timers.add(timer);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return listen(server).then((port) => ({
    url: `http://127.0.0.1:${port}/`,
    close: () => {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  }));
}

async function expectClientTimeout(mode: "headers" | "body", code: string): Promise<void> {
  const held = await holdServer(mode, LATE_HOLD_MS, "late");
  const controller = new AbortController();
  const started = Date.now();
  try {
    const outcome = await Promise.race([
      createFetchChutesTransport()
        .post(held.url, {
          headers: { "content-type": "application/json" },
          body: "{}",
          signal: controller.signal,
          timeoutMs: CLIENT_TIMEOUT_MS,
        })
        .then(
          () => "resolved" as const,
          (err: unknown) => err,
        ),
      new Promise<"open">((resolve) => {
        setTimeout(() => resolve("open"), LATE_BOUND_MS);
      }),
    ]);
    assert.ok(
      outcome instanceof Error,
      `expected ${code}, still open after ${Date.now() - started}ms`,
    );
    assert.equal(causeCode(outcome), code);
    assert.ok(Date.now() - started < LATE_BOUND_MS);
  } finally {
    controller.abort();
    await held.close();
  }
}

async function callHeld(
  mode: "headers" | "body",
  holdMs: number,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof requestChutesCompletion>>> {
  const held = await holdServer(mode, holdMs, completionBody("ok"));
  try {
    return await requestChutesCompletion(
      config(held.url),
      [{ role: "user", content: "hi" }],
      createFetchChutesTransport(),
      withTestChutesModelEnv(process.env),
      800,
      ["p1"],
      undefined,
      undefined,
      undefined,
      timeoutMs,
    );
  } finally {
    await held.close();
  }
}

function undiciTimeout(code: "UND_ERR_HEADERS_TIMEOUT" | "UND_ERR_BODY_TIMEOUT"): TypeError {
  const cause = new Error(
    code === "UND_ERR_HEADERS_TIMEOUT" ? "Headers Timeout Error" : "Body Timeout Error",
  );
  cause.name = code === "UND_ERR_HEADERS_TIMEOUT" ? "HeadersTimeoutError" : "BodyTimeoutError";
  Object.assign(cause, { code });
  return new TypeError(code === "UND_ERR_BODY_TIMEOUT" ? "terminated" : "fetch failed", { cause });
}

describe("Chutes client timeouts", () => {
  beforeEach(() => {
    installByteQuarterMockTokenizer();
  });

  afterEach(() => {
    clearMockTokenizer();
  });

  it("does not leave the Chutes header or body timeout at its default", async () => {
    await expectClientTimeout("headers", "UND_ERR_HEADERS_TIMEOUT");
    await expectClientTimeout("body", "UND_ERR_BODY_TIMEOUT");
  });

  it("reports a late localhost response as a Chutes timeout", async () => {
    const started = Date.now();
    await assert.rejects(
      () => callHeld("headers", LATE_HOLD_MS, CLIENT_TIMEOUT_MS),
      (err: unknown) => {
        assert.ok(err instanceof LlmCallError);
        assert.equal(err.code, "timeout");
        assert.equal(err.message, "Chutes request timed out");
        return true;
      },
    );
    assert.ok(Date.now() - started < LATE_BOUND_MS);
  });

  it("accepts a localhost response that arrives inside the Chutes timeout", async () => {
    const started = Date.now();
    const result = await callHeld("headers", 30, 5_000);
    assert.equal(result.content, "ok");
    assert.ok(Date.now() - started < 2_000);
  });

  it("classifies an undici header or body timeout as a Chutes timeout", async () => {
    for (const code of ["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"] as const) {
      const transport: ChutesTransport = {
        async post() {
          throw undiciTimeout(code);
        },
      };
      await assert.rejects(
        () =>
          requestChutesCompletion(
            config("http://127.0.0.1:9/v1/chat/completions"),
            [{ role: "user", content: "hi" }],
            transport,
            withTestChutesModelEnv(process.env),
            800,
            ["p1"],
            undefined,
            undefined,
            undefined,
            5_000,
          ),
        (err: unknown) => {
          assert.ok(err instanceof LlmCallError);
          assert.equal(err.code, "timeout");
          assert.equal(err.message, "Chutes request timed out");
          return true;
        },
      );
    }
  });
});
