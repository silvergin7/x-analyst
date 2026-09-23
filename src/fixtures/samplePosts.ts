import type { Post } from "../types.js";

/** Fictional fixture base — not live X URLs. */
export const FIXTURE_POST_BASE = "https://fixture.x-analyst.local/posts";

function post(
  handle: string,
  id: string,
  iso: string,
  kind: Post["kind"],
  text: string,
  extra?: Pick<Post, "analystComment">,
): Post {
  return {
    id,
    authorHandle: handle,
    text,
    timestamp: iso,
    url: `${FIXTURE_POST_BASE}/${handle}/${id}`,
    kind,
    ...extra,
  };
}

/** Deterministic fixture posts keyed by normalized handle. */
export const FIXTURE_POSTS_BY_HANDLE: Readonly<Record<string, readonly Post[]>> =
  {
    bullmacro: [
      post(
        "bullmacro",
        "b1",
        "2026-09-20T14:00:00.000Z",
        "original",
        "Liquidity conditions improving; risk assets have room to run into year-end.",
      ),
      post(
        "bullmacro",
        "b2",
        "2026-09-18T09:30:00.000Z",
        "original",
        "Earnings revisions still trending up — staying constructive on equities.",
      ),
      post(
        "bullmacro",
        "b3",
        "2026-09-15T16:00:00.000Z",
        "repost",
        "RT @someother: Thread on semiconductor demand.",
      ),
    ],
    bearmacro: [
      post(
        "bearmacro",
        "r1",
        "2026-09-21T11:00:00.000Z",
        "original",
        "Credit spreads widening; reducing exposure until the cycle clears.",
      ),
      post(
        "bearmacro",
        "r2",
        "2026-09-19T08:00:00.000Z",
        "original",
        "Recession risk underpriced — favor defensives and short duration.",
      ),
      post(
        "bearmacro",
        "r3",
        "2026-09-17T13:00:00.000Z",
        "quote",
        "Fed official cites persistent inflation.",
        { analystComment: "This supports my cautious stance on duration." },
      ),
    ],
    unclearmacro: [
      post(
        "unclearmacro",
        "u1",
        "2026-09-22T10:00:00.000Z",
        "repost",
        "RT @newswire: Markets mixed ahead of data.",
      ),
      post(
        "unclearmacro",
        "u2",
        "2026-09-16T12:00:00.000Z",
        "quote",
        "Chart of the week: yields vs equities.",
      ),
      post(
        "unclearmacro",
        "u3",
        "2026-09-10T09:00:00.000Z",
        "original",
        "Busy week — back soon.",
      ),
    ],
    emptymacro: [],
  };

export function knownFixtureHandles(): string[] {
  return Object.keys(FIXTURE_POSTS_BY_HANDLE);
}
