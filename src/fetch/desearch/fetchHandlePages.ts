import type { Post } from "../../types.js";
import { buildDesearchPostsRequest } from "./buildRequest.js";
import { desearchErrorMessage, type DesearchTransport } from "./desearchTransport.js";
import { parseAssumedDesearchResponse } from "./parseAssumedResponse.js";

export interface FetchHandlePagesResult {
  posts: Post[];
  /** False when assumed API reported has_more but retrieval stopped due to caps. */
  apiExhaustedForCaps: boolean;
  stoppedDueToCap: boolean;
}

/**
 * Paginate via injected transport until per-handle budget or total remaining cap is satisfied.
 */
export async function fetchHandlePages(
  handle: string,
  apiKey: string,
  transport: DesearchTransport,
  options: {
    maxPostsThisHandle: number;
    remainingTotalCap: number;
  },
): Promise<FetchHandlePagesResult> {
  const collected: Post[] = [];
  let cursor: string | undefined;
  let stoppedDueToCap = false;
  let sawHasMoreFromApi = false;

  while (collected.length < options.maxPostsThisHandle) {
    const remainingForHandle = options.maxPostsThisHandle - collected.length;
    const remainingTotal = options.remainingTotalCap - collected.length;
    if (remainingTotal <= 0) {
      stoppedDueToCap = true;
      break;
    }

    const pageLimit = Math.min(remainingForHandle, remainingTotal);
    const request = buildDesearchPostsRequest(handle, pageLimit, apiKey, cursor);
    const response = await transport.execute(request);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(desearchErrorMessage(response.status, response.body));
    }

    const parsed = parseAssumedDesearchResponse(handle, response.body);
    if (!parsed.ok) {
      throw new Error(
        `Desearch response could not be parsed (${parsed.reason}). Assumed contract only — verify with official API before live use.`,
      );
    }

    if (parsed.posts.length === 0) {
      break;
    }

    for (const post of parsed.posts) {
      if (collected.length >= options.maxPostsThisHandle) {
        stoppedDueToCap = true;
        break;
      }
      if (collected.length >= options.remainingTotalCap) {
        stoppedDueToCap = true;
        break;
      }
      collected.push(post);
    }

    if (parsed.hasMore) {
      sawHasMoreFromApi = true;
    }

    if (stoppedDueToCap) {
      break;
    }

    if (!parsed.hasMore || !parsed.nextCursor) {
      break;
    }

    cursor = parsed.nextCursor;
  }

  const apiExhaustedForCaps =
    sawHasMoreFromApi &&
    (stoppedDueToCap || collected.length >= options.maxPostsThisHandle);

  return {
    posts: collected,
    apiExhaustedForCaps,
    stoppedDueToCap,
  };
}
