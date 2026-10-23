import { desearchListPriceUsd } from "../config/desearchSettings.js";
import {
  buildTwitterUserPostsRequest,
  type DesearchPostsRequest,
} from "../fetch/desearch/buildRequest.js";

export const DESEARCH_OBSERVED_MAX_POSTS_PER_RESPONSE = 20;

export function desearchCountQueryParam(request: DesearchPostsRequest): number | undefined {
  const url = new URL(request.url);
  const raw = url.searchParams.get("count");
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < 1) return undefined;
  return n;
}

export function describeDesearchCountOnWire(request: DesearchPostsRequest): string {
  const count = desearchCountQueryParam(request);
  if (count === undefined) {
    return "count query parameter: not sent on GET /twitter/user/posts";
  }
  return `count query parameter: ${count}`;
}

export function desearchWorstCasePostsPerRequest(request: DesearchPostsRequest): {
  postsPerRequest: number;
  basis: string;
} {
  const sent = desearchCountQueryParam(request);
  if (sent === undefined) {
    return {
      postsPerRequest: DESEARCH_OBSERVED_MAX_POSTS_PER_RESPONSE,
      basis: `observed usage_count up to ${DESEARCH_OBSERVED_MAX_POSTS_PER_RESPONSE} per response (count not sent on the request)`,
    };
  }
  return {
    postsPerRequest: Math.max(sent, DESEARCH_OBSERVED_MAX_POSTS_PER_RESPONSE),
    basis: `max(count sent (${sent}), observed ${DESEARCH_OBSERVED_MAX_POSTS_PER_RESPONSE})`,
  };
}

export function desearchWorstCaseListPriceUsd(input: {
  handles: number;
  requestsPerHandle: number;
  sampleRequest: DesearchPostsRequest;
}): { usageCount: number; listPriceUsd: number; postsPerRequest: number; basis: string } {
  const { postsPerRequest, basis } = desearchWorstCasePostsPerRequest(input.sampleRequest);
  const usageCount = input.handles * input.requestsPerHandle * postsPerRequest;
  return {
    usageCount,
    listPriceUsd: desearchListPriceUsd(usageCount),
    postsPerRequest,
    basis,
  };
}

export function sampleDesearchRequest(): DesearchPostsRequest {
  return buildTwitterUserPostsRequest("sample", "sample-key");
}
