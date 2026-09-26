import https from "node:https";
import type { DesearchPostsRequest } from "./buildRequest.js";
import type { DesearchTransport } from "./desearchTransport.js";

export type HttpsRequestFn = typeof https.request;

const DEFAULT_TIMEOUT_MS = 30_000;

export class HttpDesearchTransportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpDesearchTransportConfigError";
  }
}

export interface HttpDesearchTransportOptions {
  timeoutMs?: number;
  /** Injectable for tests — defaults to `node:https`.request. */
  httpsRequest?: HttpsRequestFn;
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isFinite(timeoutMs) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new HttpDesearchTransportConfigError(
      "timeoutMs must be a positive finite safe integer",
    );
  }
  return timeoutMs;
}

/**
 * HTTPS transport for documented Desearch GET endpoints.
 * Never log request headers (Authorization contains the API key).
 */
export function createHttpDesearchTransport(
  options: HttpDesearchTransportOptions = {},
): DesearchTransport {
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const httpsRequest = options.httpsRequest ?? https.request;

  return {
    execute(request: DesearchPostsRequest): Promise<{ status: number; body: unknown }> {
      const url = new URL(request.url);
      if (url.protocol !== "https:") {
        return Promise.reject(
          new Error("Desearch request URL must use https:"),
        );
      }
      return new Promise((resolve, reject) => {
        const req = httpsRequest(
          {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || undefined,
            path: `${url.pathname}${url.search}`,
            method: request.method,
            headers: request.headers,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              if (text.length === 0) {
                resolve({ status: res.statusCode ?? 0, body: null });
                return;
              }
              try {
                const body = JSON.parse(text) as unknown;
                resolve({ status: res.statusCode ?? 0, body });
              } catch {
                reject(new Error("Desearch response was not valid JSON"));
              }
            });
            res.on("error", reject);
          },
        );

        req.on("error", (err: Error) => {
          reject(new Error(`Desearch HTTPS request failed: ${err.message}`));
        });

        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error("Desearch request timed out"));
        });

        req.end();
      });
    },
  };
}
