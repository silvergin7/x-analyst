import type { DesearchBilling } from "../../types.js";
import type { DesearchPostsRequest } from "./buildRequest.js";

/** Injected transport — tests provide a mock; production wiring uses HTTPS. */
export interface DesearchTransport {
  execute(request: DesearchPostsRequest): Promise<{
    status: number;
    body: unknown;
    billing?: DesearchBilling;
  }>;
}

export type DesearchFailureCategory =
  | "http_status"
  | "timeout"
  | "network"
  | "invalid_json"
  | "parse";

/** Retrieval stopped after one or more responses, or before a usable body. */
export class DesearchRetrievalError extends Error {
  readonly category: DesearchFailureCategory;
  readonly status?: number;
  readonly billing: DesearchBilling[];

  constructor(
    message: string,
    details: {
      category: DesearchFailureCategory;
      status?: number;
      billing?: DesearchBilling[];
    },
  ) {
    super(message);
    this.name = "DesearchRetrievalError";
    this.category = details.category;
    this.status = details.status;
    this.billing = details.billing ?? [];
  }
}

/** HTTP status only. Provider body text is omitted. */
export function desearchErrorMessage(status: number): string {
  const code = Number.isInteger(status) ? status : 0;
  return `Desearch request failed (HTTP ${code}).`;
}
