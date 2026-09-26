# x-analyst (mock CLI prototype)

**This version uses fictional posts and deterministic mock analysis only.** It makes **no live API calls** (no Desearch, no LLM) and **incurs no data or LLM charges.**

Local command-line prototype: enter a few analyst handles, retrieve a bounded slice of **fixture** posts per person, and print a per-person market-outlook report with evidence links (fictional URLs).

## Requirements

- Node.js 20+

## Install

```bash
npm install
```

## Run

Default handles (`bullmacro`, `bearmacro`, `unclearmacro`) and default question:

```bash
npm run start
```

Custom handles and question:

```bash
npm run start -- --handles bullmacro,bearmacro,unclearmacro --question "What is each analyst's current market outlook?"
```

Optional limits (for future live fetch parity):

```bash
MAX_POSTS_PER_PERSON=5 MAX_POSTS_TOTAL=12 npm run start
```

When a limit prevents retrieving all fixture posts, the CLI reports **partial** retrieval or **incomplete** retrieval (analyst not examined). Analysts skipped because `MAX_POSTS_TOTAL` was exhausted do **not** receive an `unclear` outlook line.

## Test and typecheck

```bash
npm test
npm run typecheck
```

## What is mocked

| Piece | Current implementation | Future replacement |
|-------|------------------------|--------------------|
| Post retrieval | `MockPostsFetcher` reads `src/fixtures/samplePosts.ts` | Desearch (or similar) client implementing `PostsFetcher` |
| Outlook analysis | `MockOutlookAnalyzer` uses simple keyword rules | LLM client implementing `OutlookAnalyzer` |

Fixture post URLs use the fictional domain `fixture.x-analyst.local` — **not** live X links.

## Limitations

- Manual handle list only; no X Lists or OAuth.
- No database, web UI, auth, or deployment.
- Mock analysis is **not** LLM inference; do not treat output as verified market research.

## Post provider (mock default)

The CLI **always** uses `MockPostsFetcher` (local fixtures). No network requests are made on this branch.

Optional future Desearch settings are documented in `.env.example` only:

- `POSTS_PROVIDER=mock` (default)
- `DESEARCH_API_KEY` — placeholder until you obtain credentials
- `DESEARCH_LIVE_ENABLED=false` — must be `true` with a real key before any live Desearch path is allowed

`DesearchPostsFetcher` targets the documented **`GET /twitter/user/posts`** contract (`username`, optional `cursor`, raw API key in `Authorization`). It is used in tests and future wiring with an **injected transport only** — **no production HTTP transport** and **no live API requests** in this prototype.

**Caps are not spend limits:** `MAX_POSTS_PER_PERSON` / `MAX_POSTS_TOTAL` limit how many posts are **kept for analysis**. `DESEARCH_MAX_REQUESTS_PER_RUN` limits **HTTP calls per run** (see `.env.example`). None of these guarantee a maximum Desearch bill; each response may include an undocumented number of billable posts. Confirm rates and usage in the Desearch Console before any live call.

Before live use: obtain credentials, implement a real transport behind the interface, and approve one capped test request with billing headers reviewed.

## Secrets

Copy `.env.example` to `.env` locally when ready for live services. Never commit `.env`, real API keys, or sensitive API responses.
