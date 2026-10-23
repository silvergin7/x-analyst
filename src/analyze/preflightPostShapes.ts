import type { Post } from "../types.js";

export function modestPreflightPosts(count: number): Post[] {
  const text = "Risk assets can still reprice if growth cools from here.";
  return Array.from({ length: count }, (_, index) => ({
    id: `preflight-modest-${index}`,
    authorHandle: "preflight",
    kind: "original" as const,
    text,
    timestamp: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    url: `https://fixture.x-analyst.local/preflight-modest-${index}`,
  }));
}

export function longPreflightPosts(count: number): Post[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `preflight-long-${index}`,
    authorHandle: "preflight",
    kind: "quote" as const,
    text: "",
    analystComment: "x".repeat(1000),
    quotedPostText: "q".repeat(500),
    timestamp: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    url: `https://fixture.x-analyst.local/preflight-long-${index}`,
  }));
}
