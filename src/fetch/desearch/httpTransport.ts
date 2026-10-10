import https from "node:https";
import type { DesearchBilling } from "../../types.js";
import type { DesearchPostsRequest } from "./buildRequest.js";
import {
  DesearchRetrievalError,
  type DesearchTransport,
} from "./desearchTransport.js";

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

function headerValue(
  headers: NodeJS.Dict<string | string[]> | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function finiteHeaderNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteBodyNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bodyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Keep billing fields Desearch actually returned.
 * A missing header or body field stays missing. Header values fill first.
 */
export function readDesearchBilling(
  headers: NodeJS.Dict<string | string[]> | undefined,
  body: unknown,
): DesearchBilling | undefined {
  const billing: DesearchBilling = {};
  const headerCost = finiteHeaderNumber(headerValue(headers, "x-desearch-cost-usd"));
  const headerUsage = finiteHeaderNumber(headerValue(headers, "x-desearch-usage-count"));
  const headerService = headerValue(headers, "x-desearch-service")?.trim();
  const headerCurrency = headerValue(headers, "x-desearch-currency")?.trim();
  if (headerCost !== undefined) billing.costUsd = headerCost;
  if (headerUsage !== undefined) billing.usageCount = headerUsage;
  if (headerService) billing.service = headerService;
  if (headerCurrency) billing.currency = headerCurrency;

  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (billing.costUsd === undefined) {
      const cost = finiteBodyNumber(record.cost_usd);
      if (cost !== undefined) billing.costUsd = cost;
    }
    if (billing.usageCount === undefined) {
      const usage = finiteBodyNumber(record.usage_count);
      if (usage !== undefined) billing.usageCount = usage;
    }
    if (billing.service === undefined) {
      const service = bodyString(record.service);
      if (service !== undefined) billing.service = service;
    }
    if (billing.currency === undefined) {
      const currency = bodyString(record.currency);
      if (currency !== undefined) billing.currency = currency;
    }
  }

  return Object.keys(billing).length === 0 ? undefined : billing;
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
    execute(request: DesearchPostsRequest): Promise<{
      status: number;
      body: unknown;
      billing?: DesearchBilling;
    }> {
      const url = new URL(request.url);
      if (url.protocol !== "https:") {
        return Promise.reject(
          new Error("Desearch request URL must use https:"),
        );
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (action: () => void) => {
          if (settled) return;
          settled = true;
          action();
        };
        const failNetwork = () => {
          finish(() => {
            reject(
              new DesearchRetrievalError("Desearch HTTPS request failed.", {
                category: "network",
              }),
            );
          });
        };
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
                const billing = readDesearchBilling(res.headers, null);
                finish(() => {
                  resolve({
                    status: res.statusCode ?? 0,
                    body: null,
                    ...(billing ? { billing } : {}),
                  });
                });
                return;
              }
              try {
                const body = JSON.parse(text) as unknown;
                const billing = readDesearchBilling(res.headers, body);
                finish(() => {
                  resolve({
                    status: res.statusCode ?? 0,
                    body,
                    ...(billing ? { billing } : {}),
                  });
                });
              } catch {
                const billing = readDesearchBilling(res.headers, null);
                finish(() => {
                  reject(
                    new DesearchRetrievalError("Desearch response was not valid JSON.", {
                      category: "invalid_json",
                      billing: billing ? [billing] : [],
                    }),
                  );
                });
              }
            });
            res.on("error", () => {
              failNetwork();
            });
          },
        );

        req.on("error", () => {
          failNetwork();
        });

        req.setTimeout(timeoutMs, () => {
          finish(() => {
            reject(
              new DesearchRetrievalError("Desearch request timed out.", {
                category: "timeout",
              }),
            );
          });
          req.destroy();
        });

        req.end();
      });
    },
  };
}
