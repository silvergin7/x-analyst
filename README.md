# x-analyst (local mock prototype)

Local-first prototype: a manual list of analyst handles, a bounded slice of **that person's** recent posts, and a per-person market-outlook report with linked evidence.

**Default paths use fictional fixture posts and deterministic keyword rules.** `npm run start`, `npm run dev:server`, and `npm run dev:web` make **no live Desearch, X, or LLM calls** and **incur no data or model charges.**

## End-goal product

A local web app for one person on their own machine.

They enter a few analyst handles and a question, then run it once. The default question is each analyst’s current market outlook. For every handle, the app loads a bounded recent slice of **that account’s own posts** from Desearch. An LLM reads those posts as source material and returns one outlook per person: bullish, bearish, cautious, or unclear.

Each result shows the outlook, a short explanation, the dates and number of posts examined, whether that slice was complete, and links to the posts that support the call. Every link keeps the author, time, post id, URL, and whether the post is an original, a repost, or a quote. The explanation separates the analyst’s own words from reposts, quotes, sarcasm, stale remarks, and the model’s reading. Thin evidence stays unclear. A handle that was never fetched has no outlook line. The same run can be printed from the CLI.

When Desearch or the LLM reports usage or cost, the app shows it. A repeated run reuses a fetch it already paid for. Limits and model names stay in config.

It stays a single-user local tool: a manual roster, with no accounts, hosted deployment, database, background jobs, or X List / OAuth sync.

## Requirements

- Node.js 20+

## Install

```bash
npm install
```

## CLI

Default handles (`bullmacro`, `bearmacro`, `unclearmacro`) and default question:

```bash
npm run start
```

Custom handles and question:

```bash
npm run start -- --handles bullmacro,bearmacro,unclearmacro --question "What is each analyst's current market outlook?"
```

Optional retention caps (also apply to the mock web API, which calls the same report runner):

```bash
MAX_POSTS_PER_PERSON=5 MAX_POSTS_TOTAL=12 npm run start
```

When a cap stops a full fixture slice, the CLI reports **partial** retrieval (outlook from the posts that were kept) or **incomplete** retrieval (analyst not examined, no outlook line). Handles skipped because `MAX_POSTS_TOTAL` was already used do **not** get an `unclear` outlook.

The CLI always uses `MockPostsFetcher`, regardless of environment variables.

## Local web preview

Two processes. The API binds to loopback only.

```bash
npm run dev:server
```

```bash
npm run dev:web
```

- API: `http://127.0.0.1:3001` (`PORT` overrides the port)
- Vite: `http://127.0.0.1:5173`, proxying `/api` to the API

The page keeps a mock-mode banner and a check of `GET /api/meta`. It also has handles and question fields. The question starts as `What is each analyst's current market outlook?`. Submitting the form calls the existing `POST /api/analyze` and shows one card per returned report: handle, outlook, explanation, dates examined, post count, retrieval coverage, and evidence. Evidence URLs are labeled as fictional fixture links. Invalid, unknown, empty, and unexamined handles are separate status lines, with no outlook card.

The mock analyzer uses fixed keyword rules. Changing the question does not change the analysis.

`POST /api/analyze` body: `{ "handles": "bullmacro,bearmacro", "question": "..." }`. It returns `{ mode, question, invalidHandles, fetchOutcomes, reports }`.

## Test and typecheck

```bash
npm test
npm run typecheck
```

`npm test` runs the Node test runner over `test/`, `test/desearch/`, `test/format/`, and `test/server/`, then `vitest run --config web/vitest.config.ts` for the web UI. `npm run typecheck` checks the Node project and `web/tsconfig.json`.

## What is mocked on the default path

| Piece | Current default | Later replacement |
|-------|-----------------|-------------------|
| Post retrieval | `MockPostsFetcher` reads `src/fixtures/samplePosts.ts` | `DesearchPostsFetcher` behind `createPostsFetcherFromEnv()` |
| Outlook analysis | `MockOutlookAnalyzer` keyword rules on the CLI, API, and web UI | Opt-in `LlmOutlookAnalyzer` via `npm run analyze:llm-fixture` |
| Web UI | Form submits to `/api/analyze` and shows mock report cards | Live Desearch posts and an LLM outlook |

Fixture URLs use `https://fixture.x-analyst.local/...`. They are not live X links. Fixture handles: `bullmacro`, `bearmacro`, `unclearmacro`, `emptymacro` (empty list).

## Live Desearch (opt-in code, unused by CLI and web)

`createPostsFetcherFromEnv()` can return a live fetcher only when **all** of the following are set (see `.env.example`):

- `POSTS_PROVIDER=desearch`
- `DESEARCH_LIVE_ENABLED=true`
- `DESEARCH_API_KEY` set to a real key (not the placeholder `replace_me_only_when_you_are_ready`)

If any gate fails, that factory returns mock fixtures. Live calls use **`GET https://api.desearch.ai/twitter/user/posts`**. The `Authorization` header is the raw API key (no `Bearer` prefix).

**Caps are not dollar limits.** `MAX_POSTS_PER_PERSON` and `MAX_POSTS_TOTAL` limit posts **kept for analysis**. `DESEARCH_MAX_REQUESTS_PER_RUN` limits **HTTP requests per run** (default 5). A response can still contain an undocumented number of billable posts. Confirm current rates in the Desearch console before any live call. Copy `.env.example` to a local `.env` only when you intend to use live services. Do not commit `.env`.

## Opt-in Chutes fixture check

`npm start`, the API, and the web UI still construct `MockOutlookAnalyzer` and do not read the Chutes flags. `PersonOutlookReport.analysisSource` on those paths stays `"mock"`.

`npm run analyze:llm-fixture -- <handle>` reads one fixture handle through `MockPostsFetcher`. It calls Chutes only when all of the following are true (see `.env.example`):

- `ANALYSIS_PROVIDER=chutes`
- `LLM_LIVE_ENABLED=true`
- `CHUTES_API_KEY` set to a real key (not the placeholder `replace_me_only_when_you_are_ready`)
- `LLM_MODEL=Qwen/Qwen3-32B-TEE`

The request goes to `https://llm.chutes.ai/v1/chat/completions` with `max_tokens` 800, `/no_think`, and strict JSON schema. The coded rates are $0.104 per million input tokens and $0.416 per million output tokens. `$0.05` is a local budget for one later approved call. Chutes does not enforce that dollar amount. Before a request, the command prints a pessimistic ceiling: one token per UTF-8 byte of the serialized request, plus 32 tokens of framing per message. That ceiling is not provider-reported usage. A higher estimate, or any other model name, stops before the request. A model change needs a new rate and a new estimate.

The question is limited to 500 characters. At most 10 eligible posts are sent, and each text is cut at 1,000 characters. Original posts send their own text. A quote sends only non-empty analyst commentary. Reposts and quotes without that commentary are excluded and are not described as model-examined. Retrieval coverage stays the fetch result. Citation metadata is copied from the supplied posts. A refusal, a non-200 response, or `finish_reason` `length` fails the run. There is no retry, fallback, or limit increase. When a failed response includes token usage, the command prints that usage separately from the failure. Transport failures print a fixed message and do not echo the underlying error text.

Optional `--as-of YYYY-MM-DD` sets the analysis reference date used for “current”. When omitted, the command uses the UTC date of the run. The output labels the run as a synthetic fixture test, not current real-world research.

Do not run this command until a separate live-call approval. Automated tests mock the HTTP response and do not call Chutes.

## Limitations

- Roster is a manual handle list. No X Lists, OAuth, accounts, database, or deployment.
- Mock analysis is keyword rules, not model inference. Do not treat the report as verified market research.
- Retrieved posts are untrusted data. Reports keep author, timestamp, post id, URL, and post kind on every citation.
