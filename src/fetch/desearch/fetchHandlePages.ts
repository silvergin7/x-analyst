import { comparePostTime } from "../../analyze/analysisInput.js";
import { dedupePostsById } from "../dedupePosts.js";
import type { DesearchBilling, FetchStopReason, Post } from "../../types.js";
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
  stopReason: FetchStopReason;
  /** Latest response had next_cursor and fetching stopped before that page. */
  apiHasMorePages: boolean;
  requestsUsed: number;
  billing: DesearchBilling[];
  duplicatesRemoved: number;
}

function advanceCursor(nextCursor: string, seenCursors: Set<string>): string {
  if (seenCursors.has(nextCursor)) {
    throw new DesearchPaginationError("Desearch pagination returned a repeated cursor");
  }
  seenCursors.add(nextCursor);
  return nextCursor;
}

function oldestParsedMs(posts: readonly Post[]): number | null {
  let oldest: number | null = null;
  for (const post of posts) {
    const ms = Date.parse(post.timestamp);
    if (!Number.isFinite(ms)) continue;
    if (oldest === null || ms < oldest) oldest = ms;
  }
  return oldest;
}

/**
 * Paginate until the oldest kept post is past the lookback window, the account
 * has no further page, or the request budget is used up. Every valid post from
 * a response that was fetched is kept. Post count is not a stop.
 */
export async function fetchHandlePages(
  username: string,
  apiKey: string,
  transport: DesearchTransport,
  options: {
    requestBudgetRemaining: number;
    lookbackCutoffMs: number;
  },
): Promise<FetchHandlePagesResult> {
  const collected: Post[] = [];
  let cursor: string | undefined;
  let stopReason: FetchStopReason = "no_more_pages";
  let lastResponseHasMorePages = false;
  let requestsUsed = 0;
  const billing: DesearchBilling[] = [];
  const seenCursors = new Set<string>();
  let withinPageDuplicates = 0;

  const moveCursor = (nextCursor: string): string => {
    try {
      return advanceCursor(nextCursor, seenCursors);
    } catch (err) {
      if (err instanceof DesearchPaginationError) {
        throw new DesearchPaginationError(err.message, billing);
      }
      throw err;
    }
  };

  while (true) {
    if (options.requestBudgetRemaining - requestsUsed <= 0) {
      stopReason = "desearch_request_budget_exhausted";
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
    withinPageDuplicates += parsed.duplicatesRemoved;
    collected.push(...parsed.posts);

    const oldest = oldestParsedMs(parsed.posts);
    if (oldest !== null && oldest < options.lookbackCutoffMs) {
      stopReason = "lookback_window_reached";
      break;
    }

    if (!parsed.hasMorePages || !parsed.nextCursor) {
      stopReason = "no_more_pages";
      break;
    }

    cursor = moveCursor(parsed.nextCursor);
  }

  const deduped = dedupePostsById(collected);
  deduped.posts.sort((a, b) => comparePostTime(b, a));
  return {
    posts: deduped.posts,
    stopReason,
    apiHasMorePages: lastResponseHasMorePages && stopReason !== "no_more_pages",
    requestsUsed,
    billing,
    duplicatesRemoved: deduped.duplicatesRemoved + withinPageDuplicates,
  };
}
