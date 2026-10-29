import { CHUTES_CATALOG_MAX_BYTES } from "../config/llmSettings.js";
import { BoundedBodyTooLargeError, readResponseBodyWithCap } from "./boundedHttpRead.js";

export interface ChutesCatalogTransportResponse {
  status: number;
  bodyText: string;
}

export interface ChutesCatalogTransport {
  get(url: string, signal: AbortSignal): Promise<ChutesCatalogTransportResponse>;
}

export function createFetchChutesCatalogTransport(
  fetchImpl: typeof fetch = fetch,
): ChutesCatalogTransport {
  return {
    async get(url, signal) {
      const response = await fetchImpl(url, { method: "GET", signal });
      let body: Buffer;
      try {
        body = await readResponseBodyWithCap(response, CHUTES_CATALOG_MAX_BYTES);
      } catch (err) {
        if (err instanceof BoundedBodyTooLargeError) {
          throw err;
        }
        throw err;
      }
      return { status: response.status, bodyText: body.toString("utf8") };
    },
  };
}
