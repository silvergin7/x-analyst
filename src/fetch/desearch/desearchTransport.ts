import type { DesearchPostsRequest } from "./buildRequest.js";

/** Injected transport — tests provide a mock; production wiring adds HTTP later. */
export interface DesearchTransport {
  execute(request: DesearchPostsRequest): Promise<{
    status: number;
    body: unknown;
  }>;
}

/** Sanitize external error text — never echo secrets; treat as untrusted. */
export function desearchErrorMessage(status: number, body: unknown): string {
  let snippet = "";
  if (typeof body === "string") {
    snippet = body.slice(0, 120);
  } else if (body !== null && typeof body === "object" && "message" in body) {
    const msg = (body as { message: unknown }).message;
    if (typeof msg === "string") snippet = msg.slice(0, 120);
  }
  return `Desearch request failed (HTTP ${status}). External message (untrusted): ${snippet || "none"}`;
}
