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

The CLI **always** uses `MockPostsFetcher` (local fixtures) via `npm run start`, **regardless of environment variables**. The default CLI path makes **no Desearch HTTP requests**.

### Live Desearch (opt-in, not used by CLI)

Non-CLI code paths that call `createPostsFetcherFromEnv()` can use live Desearch only when **all** of the following are set (see `.env.example`):

- `POSTS_PROVIDER=desearch`
- `DESEARCH_LIVE_ENABLED=true`
- `DESEARCH_API_KEY` set to a **real** key (not the placeholder)

If any gate fails, the env factory falls back to **mock fixtures**. Live calls use **`GET https://api.desearch.ai/twitter/user/posts`** with the raw API key in the `Authorization` header (no `Bearer` prefix).

**Caps are not dollar limits:** `MAX_POSTS_PER_PERSON` and `MAX_POSTS_TOTAL` limit how many posts are **retained for analysis**. `DESEARCH_MAX_REQUESTS_PER_RUN` limits **HTTP requests per run**. None of these caps guarantee a maximum Desearch bill—each response may return an undocumented number of billable posts. Confirm current rates and usage in the Desearch Console before enabling live mode.

Copy `.env.example` to a local `.env` when you are ready; never commit secrets. Approve one capped live test before relying on production data.

## Secrets

Copy `.env.example` to `.env` locally when ready for live services. Never commit `.env`, real API keys, or sensitive API responses.
