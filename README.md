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

## Secrets

When live APIs are added, use a `.env` file (see `.env.example` in a later step). Never commit `.env` or real API responses.
