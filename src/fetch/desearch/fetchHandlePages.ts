import type { DesearchBilling, Post } from "../../types.js";
import { buildTwitterUserPostsRequest } from "./buildRequest.js";
import {
  DesearchRetrievalError,
  desearchErrorMessage,
  type DesearchTransport,
} from "./desearchTransport.js";
import { parseTwitterUserPostsResponse } from "./parseAssumedResponse.js";

export class DesearchPaginationError extends Error {
  readonly billing: DesearchBilling[];

  constructor(message: string, billing: DesearchBilling[] = []) {
    super(message);
    this.name = "DesearchPaginationError";
    this.billing = billing;
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
  billing: DesearchBilling[];
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
  const billing: DesearchBilling[] = [];
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
    let response: Awaited<ReturnType<DesearchTransport["execute"]>>;
    try {
      response = await transport.execute(request);
    } catch (err) {
      if (err instanceof DesearchRetrievalError) {
        throw new DesearchRetrievalError(err.message, {
          category: err.category,
          status: err.status,
          billing: [...billing, ...err.billing],
        });
      }
      throw new DesearchRetrievalError("Desearch HTTPS request failed.", {
        category: "network",
        billing,
      });
    }
    requestsUsed += 1;
    if (response.billing) billing.push(response.billing);

    if (response.status < 200 || response.status >= 300) {
      throw new DesearchRetrievalError(desearchErrorMessage(response.status), {
        category: "http_status",
        status: response.status,
        billing,
      });
    }

    const parsed = parseTwitterUserPostsResponse(username, response.body);
    if (!parsed.ok) {
      throw new DesearchRetrievalError(
        `Desearch response could not be parsed (${parsed.reason}).`,
        { category: "parse", billing },
      );
    }

    lastResponseHasMorePages = parsed.hasMorePages;

    if (parsed.posts.length === 0) {
      if (parsed.hasMorePages && parsed.nextCursor) {
        cursor = moveCursor(parsed.nextCursor);
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

    cursor = moveCursor(parsed.nextCursor);
  }

  function moveCursor(nextCursor: string): string {
    try {
      return advanceCursor(nextCursor, seenCursors);
    } catch (err) {
      if (err instanceof DesearchPaginationError) {
        throw new DesearchPaginationError(err.message, billing);
      }
      throw err;
    }
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
    billing,
  };
}
