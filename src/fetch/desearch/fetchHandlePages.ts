import type { Post } from "../../types.js";
import { buildTwitterUserPostsRequest } from "./buildRequest.js";
import { desearchErrorMessage, type DesearchTransport } from "./desearchTransport.js";
import { parseTwitterUserPostsResponse } from "./parseAssumedResponse.js";

export class DesearchPaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesearchPaginationError";
  }
}

export interface FetchHandlePagesResult {
  posts: Post[];
  /** Latest response had next_cursor but retrieval stopped early (caps or request budget). */
  apiHasMorePages: boolean;
  /** Latest response had more tweets than retained after per-person/total caps (no next page required). */
  truncatedLastResponse: boolean;
  stoppedDueToCap: boolean;
  stoppedDueToRequestBudget: boolean;
  requestsUsed: number;
}

function advanceCursor(
  nextCursor: string,
  seenCursors: Set<string>,
): string {
  if (seenCursors.has(nextCursor)) {
    throw new DesearchPaginationError(
      "Desearch pagination returned a repeated cursor",
    );
  }
  seenCursors.add(nextCursor);
  return nextCursor;
}

/**
 * Paginate via injected transport until post caps or request budget is satisfied.
 */
export async function fetchHandlePages(
  username: string,
  apiKey: string,
  transport: DesearchTransport,
  options: {
    maxPostsThisHandle: number;
    remainingTotalCap: number;
    requestBudgetRemaining: number;
  },
): Promise<FetchHandlePagesResult> {
  const collected: Post[] = [];
  let cursor: string | undefined;
  let stoppedDueToCap = false;
  let stoppedDueToRequestBudget = false;
  let lastResponseHasMorePages = false;
  let truncatedLastResponse = false;
  let requestsUsed = 0;
  const seenCursors = new Set<string>();

  while (collected.length < options.maxPostsThisHandle) {
    if (options.requestBudgetRemaining - requestsUsed <= 0) {
      stoppedDueToRequestBudget = true;
      break;
    }

    const remainingTotal = options.remainingTotalCap - collected.length;
    if (remainingTotal <= 0) {
      stoppedDueToCap = true;
      break;
    }

    const request = buildTwitterUserPostsRequest(username, apiKey, cursor);
    const response = await transport.execute(request);
    requestsUsed += 1;

    if (response.status < 200 || response.status >= 300) {
      throw new Error(desearchErrorMessage(response.status, response.body));
    }

    const parsed = parseTwitterUserPostsResponse(username, response.body);
    if (!parsed.ok) {
      throw new Error(
        `Desearch response could not be parsed (${parsed.reason}).`,
      );
    }

    lastResponseHasMorePages = parsed.hasMorePages;

    if (parsed.posts.length === 0) {
      if (parsed.hasMorePages && parsed.nextCursor) {
        cursor = advanceCursor(parsed.nextCursor, seenCursors);
        continue;
      }
      break;
    }

    let retainedFromPage = 0;
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
      retainedFromPage += 1;
    }
    if (retainedFromPage < parsed.posts.length) {
      truncatedLastResponse = true;
    }

    if (stoppedDueToCap || stoppedDueToRequestBudget) {
      break;
    }

    if (!parsed.hasMorePages || !parsed.nextCursor) {
      break;
    }

    cursor = advanceCursor(parsed.nextCursor, seenCursors);
  }

  const apiHasMorePages =
    lastResponseHasMorePages &&
    (stoppedDueToCap ||
      stoppedDueToRequestBudget ||
      collected.length >= options.maxPostsThisHandle);

  return {
    posts: collected,
    apiHasMorePages,
    truncatedLastResponse,
    stoppedDueToCap,
    stoppedDueToRequestBudget,
    requestsUsed,
  };
}
