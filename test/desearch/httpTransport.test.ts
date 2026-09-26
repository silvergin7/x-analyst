import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { ClientRequest, RequestOptions } from "node:http";
import { describe, it } from "node:test";
import { buildTwitterUserPostsRequest } from "../../src/fetch/desearch/buildRequest.js";
import {
  createHttpDesearchTransport,
  HttpDesearchTransportConfigError,
  type HttpsRequestFn,
} from "../../src/fetch/desearch/httpTransport.js";

function mockResponse(statusCode: number, body: string): IncomingMessage {
  const res = new EventEmitter() as IncomingMessage;
  res.statusCode = statusCode;
  setImmediate(() => {
    if (body.length > 0) res.emit("data", Buffer.from(body, "utf8"));
    res.emit("end");
  });
  return res;
}

function mockRequest(
  res: IncomingMessage,
  onResponse: (response: IncomingMessage) => void,
): ClientRequest {
  const req = new EventEmitter() as ClientRequest;
  req.setTimeout = () => req;
  req.destroy = (err?: Error) => {
    if (err) req.emit("error", err);
    return req;
  };
  req.end = () => {
    onResponse(res);
    return req;
  };
  return req;
}

function mockHttps(
  handler: (
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => ClientRequest,
): HttpsRequestFn {
  return handler as HttpsRequestFn;
}

describe("createHttpDesearchTransport", () => {
  it("calls GET with username, cursor, and raw Authorization", async () => {
    let capturedPath = "";
    let capturedMethod = "";
    let capturedHostname = "";
    let capturedAuth = "";
    const transport = createHttpDesearchTransport({
      timeoutMs: 500,
      httpsRequest: mockHttps((opts, cb) => {
        capturedPath = opts.path ?? "";
        capturedMethod = opts.method ?? "";
        capturedHostname = opts.hostname ?? "";
        const headers = opts.headers as Record<string, string | undefined>;
        capturedAuth = headers.Authorization ?? "";
        return mockRequest(
          mockResponse(200, JSON.stringify({ tweets: [], next_cursor: "" })),
          cb,
        );
      }),
    });

    const descriptor = buildTwitterUserPostsRequest(
      "bullmacro",
      "fake-key-not-real",
      "cur-1",
    );
    const result = await transport.execute(descriptor);
    assert.equal(result.status, 200);
    assert.equal(capturedMethod, "GET");
    assert.equal(capturedHostname, "api.desearch.ai");
    assert.match(capturedPath, /\/twitter\/user\/posts\?/);
    assert.match(capturedPath, /username=bullmacro/);
    assert.match(capturedPath, /cursor=cur-1/);
    assert.equal(capturedAuth, "fake-key-not-real");
    assert.doesNotMatch(capturedAuth, /^Bearer /);
  });

  it("rejects non-HTTPS URLs without calling https.request", async () => {
    let calls = 0;
    const transport = createHttpDesearchTransport({
      timeoutMs: 500,
      httpsRequest: mockHttps((_opts, _cb) => {
        calls += 1;
        return mockRequest(mockResponse(200, "{}"), _cb);
      }),
    });
    await assert.rejects(
      () =>
        transport.execute({
          method: "GET",
          url: "http://api.desearch.ai/twitter/user/posts?username=a",
          headers: { Authorization: "fake-key" },
        }),
      /must use https:/,
    );
    assert.equal(calls, 0);
  });

  it("parses JSON response bodies", async () => {
    const transport = createHttpDesearchTransport({
      timeoutMs: 500,
      httpsRequest: mockHttps((_opts, cb) =>
        mockRequest(
          mockResponse(
            200,
            JSON.stringify({ tweets: [{ id: "1" }], next_cursor: "n" }),
          ),
          cb,
        ),
      ),
    });
    const result = await transport.execute(
      buildTwitterUserPostsRequest("a", "key"),
    );
    assert.equal(result.status, 200);
    assert.ok(result.body && typeof result.body === "object");
  });

  it("returns non-2xx status without throwing", async () => {
    const transport = createHttpDesearchTransport({
      timeoutMs: 500,
      httpsRequest: mockHttps((_opts, cb) =>
        mockRequest(
          mockResponse(401, JSON.stringify({ message: "unauthorized" })),
          cb,
        ),
      ),
    });
    const result = await transport.execute(
      buildTwitterUserPostsRequest("a", "key"),
    );
    assert.equal(result.status, 401);
  });

  it("rejects on network errors", async () => {
    const transport = createHttpDesearchTransport({
      timeoutMs: 500,
      httpsRequest: mockHttps(() => {
        const req = new EventEmitter() as ClientRequest;
        req.setTimeout = () => req;
        req.destroy = () => req;
        req.end = () => {
          req.emit("error", new Error("ECONNREFUSED"));
          return req;
        };
        return req;
      }),
    });
    await assert.rejects(
      () => transport.execute(buildTwitterUserPostsRequest("a", "key")),
      /HTTPS request failed/,
    );
  });

  it("rejects malformed non-empty JSON bodies", async () => {
    const transport = createHttpDesearchTransport({
      timeoutMs: 500,
      httpsRequest: mockHttps((_opts, cb) =>
        mockRequest(mockResponse(200, "{not-json"), cb),
      ),
    });
    await assert.rejects(
      () => transport.execute(buildTwitterUserPostsRequest("a", "key")),
      /Desearch response was not valid JSON/,
    );
  });

  it("throws on invalid timeoutMs at construction", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => createHttpDesearchTransport({ timeoutMs: bad }),
        HttpDesearchTransportConfigError,
      );
    }
  });

  it("uses default timeout when timeoutMs is undefined", () => {
    assert.doesNotThrow(() => createHttpDesearchTransport({}));
  });

  it("rejects on timeout", async () => {
    const transport = createHttpDesearchTransport({
      timeoutMs: 5,
      httpsRequest: mockHttps(() => {
        const req = new EventEmitter() as ClientRequest;
        req.setTimeout = (_ms, cb) => {
          setImmediate(() => cb?.());
          return req;
        };
        req.destroy = (err?: Error) => {
          if (err) req.emit("error", err);
          return req;
        };
        req.end = () => req;
        return req;
      }),
    });
    await assert.rejects(
      () => transport.execute(buildTwitterUserPostsRequest("a", "key")),
      /timed out/,
    );
  });
});
