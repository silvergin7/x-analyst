import { BoundedBodyTooLargeError, readResponseBodyWithCap } from "./boundedHttpRead.js";
import { HF_MAX_REDIRECTS, validateRedirectUrl } from "./huggingfaceRedirect.js";
import { huggingFaceModelApiUrl } from "./huggingfaceModelApiUrl.js";
import {
  parseHuggingFaceModelInfoBody,
  type HuggingFaceModelInfo,
  type HuggingFaceModelInfoTransport,
} from "./huggingfaceModelInfo.js";

export const HF_MODEL_INFO_TIMEOUT_MS = 10_000;
export const HF_MODEL_INFO_MAX_BYTES = 5 * 1024 * 1024;

async function fetchHfJsonWithRedirects(
  startUrl: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: Buffer }> {
  let current = new URL(startUrl);
  for (let hop = 0; hop <= HF_MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:") {
      throw new Error("Hugging Face model info must use https");
    }
    const response = await fetchImpl(current.toString(), { method: "GET", signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null || location === "") {
        throw new Error("Hugging Face model info redirect missing location");
      }
      const next = new URL(location, current);
      validateRedirectUrl(current, next);
      current = next;
      continue;
    }
    const body = await readResponseBodyWithCap(response, HF_MODEL_INFO_MAX_BYTES);
    return { status: response.status, body };
  }
  throw new Error("Hugging Face model info exceeded redirect limit");
}

export function createFetchHuggingFaceModelInfoTransport(
  fetchImpl: typeof fetch = fetch,
): HuggingFaceModelInfoTransport {
  return {
    async fetchModelInfo(root: string): Promise<HuggingFaceModelInfo | null> {
      let url: string;
      try {
        url = huggingFaceModelApiUrl(root);
      } catch {
        return null;
      }
      const signal = AbortSignal.timeout(HF_MODEL_INFO_TIMEOUT_MS);
      let response: { status: number; body: Buffer };
      try {
        response = await fetchHfJsonWithRedirects(url, signal, fetchImpl);
      } catch (err) {
        if (err instanceof BoundedBodyTooLargeError) {
          return null;
        }
        throw err;
      }
      if (response.status !== 200) return null;
      try {
        const body = JSON.parse(response.body.toString("utf8")) as unknown;
        return parseHuggingFaceModelInfoBody(body);
      } catch {
        return null;
      }
    },
  };
}

export function createHuggingFaceModelInfoTransport(): HuggingFaceModelInfoTransport {
  return createFetchHuggingFaceModelInfoTransport();
}
