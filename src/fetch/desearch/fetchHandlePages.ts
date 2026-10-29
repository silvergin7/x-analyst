import { comparePostTime } from "../../analyze/analysisInput.js";
import { dedupePostsById } from "../dedupePosts.js";
import type {
  DesearchBilling,
  DesearchFailureCategory,
  FetchIncompleteReason,
  FetchStopReason,
  Post,
} from "../../types.js";
import { buildTwitterUserPostsRequest } from "./buildRequest.js";
import {
  DesearchRetrievalError,
  desearchErrorMessage,
  type DesearchTransport,
} from "./desearchTransport.js";
import {
  type InvalidPostsSkipped,
  parseTwitterUserPostsResponse,
} from "./parseAssumedResponse.js";

export class DesearchPaginationError extends Error {
  readonly billing: DesearchBilling[];

  constructor(message: string, billing: DesearchBilling[] = []) {
    super(message);
    this.name = "DesearchPaginationError";
    this.billing = billing;
  }
}

export interface FetchHandleRetrievalHalt {
  failureCategory: DesearchFailureCategory;
  httpStatus?: number;
  reason: string;
}

export interface FetchHandlePagesResult {
  posts: Post[];
  stopReason: FetchStopReason;
  /** Latest response had next_cursor and fetching stopped before that page. */
  apiHasMorePages: boolean;
  requestsUsed: number;
  billing: DesearchBilling[];
  duplicatesRemoved: number;
  invalidPostsSkipped: InvalidPostsSkipped;
  /** Set when pagination must stop before the feed ends. */
  handleIncompleteReason?: FetchIncompleteReason;
  /** Set when retrieval stopped on an error before posts could be kept. */
  retrievalHalt?: FetchHandleRetrievalHalt;
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

function mergeSkipCounts(
  target: InvalidPostsSkipped,
  source: InvalidPostsSkipped,
): void {
  for (const [code, count] of Object.entries(source)) {
    target[code] = (target[code] ?? 0) + count;
  }
}

function haltFromError(err: DesearchRetrievalError): FetchHandleRetrievalHalt {
  return {
    failureCategory: err.category,
    httpStatus: err.status,
    reason: err.message,
  };
}

function finishPartialHalt(
  collected: Post[],
  halt: FetchHandleRetrievalHalt,
  handleIncompleteReason: FetchIncompleteReason | undefined,
): FetchIncompleteReason | undefined {
  if (collected.length > 0) {
    return "desearch_retrieval_interrupted";
  }
  return handleIncompleteReason;
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
    apiBase?: string;
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
  const invalidPostsSkipped: InvalidPostsSkipped = {};
  let handleIncompleteReason: FetchIncompleteReason | undefined;
  let retrievalHalt: FetchHandleRetrievalHalt | undefined;

  const returnNow = (): FetchHandlePagesResult => {
    const deduped = dedupePostsById(collected);
    deduped.posts.sort((a, b) => comparePostTime(b, a));
    return {
      posts: deduped.posts,
      stopReason,
      apiHasMorePages: lastResponseHasMorePages && stopReason !== "no_more_pages",
      requestsUsed,
      billing,
      duplicatesRemoved: deduped.duplicatesRemoved + withinPageDuplicates,
      invalidPostsSkipped,
      handleIncompleteReason,
      retrievalHalt,
    };
  };

  while (true) {
    if (options.requestBudgetRemaining - requestsUsed <= 0) {
      stopReason = "desearch_request_budget_exhausted";
      break;
    }

    const request = buildTwitterUserPostsRequest(
      username,
      apiKey,
      cursor,
      options.apiBase,
    );
    requestsUsed += 1;
    let response: Awaited<ReturnType<DesearchTransport["execute"]>>;
    try {
      response = await transport.execute(request);
    } catch (err) {
      const haltErr =
        err instanceof DesearchRetrievalError
          ? err
          : new DesearchRetrievalError("Desearch HTTPS request failed.", {
              category: "network",
              billing: [],
            });
      billing.push(...haltErr.billing);
      retrievalHalt = haltFromError(haltErr);
      handleIncompleteReason = finishPartialHalt(collected, retrievalHalt, handleIncompleteReason);
      stopReason = "no_more_pages";
      return returnNow();
    }

    if (response.billing) billing.push(response.billing);

    if (response.status < 200 || response.status >= 300) {
      const haltErr = new DesearchRetrievalError(desearchErrorMessage(response.status), {
        category: "http_status",
        status: response.status,
        billing: [],
      });
      retrievalHalt = haltFromError(haltErr);
      handleIncompleteReason = finishPartialHalt(collected, retrievalHalt, handleIncompleteReason);
      stopReason = "no_more_pages";
      return returnNow();
    }

    const parsed = parseTwitterUserPostsResponse(username, response.body);
    if (!parsed.ok) {
      const haltErr = new DesearchRetrievalError(
        `Desearch response could not be parsed (${parsed.reason}).`,
        { category: "parse", billing: [] },
      );
      retrievalHalt = haltFromError(haltErr);
      handleIncompleteReason = finishPartialHalt(collected, retrievalHalt, handleIncompleteReason);
      stopReason = "no_more_pages";
      return returnNow();
    }

    lastResponseHasMorePages = parsed.hasMorePages;
    withinPageDuplicates += parsed.duplicatesRemoved;
    mergeSkipCounts(invalidPostsSkipped, parsed.invalidPostsSkipped);
    collected.push(...parsed.posts);

    if (parsed.sourceItemCount > 0 && parsed.posts.length === 0) {
      handleIncompleteReason = "desearch_page_no_valid_posts";
      stopReason = "no_more_pages";
      break;
    }

    const oldest = oldestParsedMs(parsed.posts);
    if (oldest !== null && oldest < options.lookbackCutoffMs) {
      stopReason = "lookback_window_reached";
      break;
    }

    if (!parsed.hasMorePages || !parsed.nextCursor) {
      stopReason = "no_more_pages";
      break;
    }

    try {
      cursor = advanceCursor(parsed.nextCursor, seenCursors);
    } catch (err) {
      const message =
        err instanceof DesearchPaginationError
          ? err.message
          : "Desearch pagination failed unexpectedly.";
      const haltErr = new DesearchRetrievalError(message, { category: "parse", billing: [] });
      retrievalHalt = haltFromError(haltErr);
      handleIncompleteReason = finishPartialHalt(collected, retrievalHalt, handleIncompleteReason);
      stopReason = "no_more_pages";
      return returnNow();
    }
  }

  return returnNow();
}
