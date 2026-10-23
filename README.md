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

## Qwen3 tokenizer (local input budget)

Live and non-test runs load **`vendor/qwen3-32b-fp8/`** only. Copy the tokenizer files from Hugging Face model **`Qwen/Qwen3-32B-FP8`** at revision **`aa55da1ecc13d006e8b8e4f54579b1ea8c3db2df`** (Apache-2.0). The folder is gitignored.

| File | Bytes | SHA-256 |
|------|------:|---------|
| `tokenizer.json` | 11,422,654 | `aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4` |
| `tokenizer_config.json` | 9,732 | `d5d09f07b48c3086c508b30d1c9114bd1189145b74e982a265350c923acd8101` |

The app verifies both checksums before counting tokens and stops if either file is missing or wrong. Optional `LLM_TOKENIZER_DIR` may point at another directory, but the files there must match the same sizes and checksums.

Input tokens use the official `chat_template` from `tokenizer_config.json` (rendered with `@huggingface/jinja`), plus the strict `response_format` JSON counted separately (conservative). A calibration margin is added on top of message tokens: **`max(128, ceil(0.02 × messageTokens))`**. The context-window check still reserves **1,024** tokens below the 40,960 window. Output `max_tokens` uses a byte pessimistic worst-case JSON ceiling plus tokenized empty `<think>` wrapper text.

## Analyst roster

Live `npm run analyze` reads [`config/analysts.json`](config/analysts.json) when `--handles` is omitted. Override the path with `ANALYST_LIST_PATH`. `--handles` overrides the file with the same validation rules (including duplicate rejection).

## CLI

Default handles (`bullmacro`, `bearmacro`, `unclearmacro`) and default question:

```bash
npm run start
```

Custom handles and question:

```bash
npm run start -- --handles bullmacro,bearmacro,unclearmacro --question "What is each analyst's current market outlook?"
```

`npm start` runs the script through a shell, which splits a quoted question into separate words. The CLI joins those words back together until the next `--` flag, so the question above arrives intact. A single already-joined argument is unchanged.

Optional retention caps (also apply to the mock web API, which calls the same report runner):

```bash
MAX_POSTS_PER_PERSON=5 MAX_POSTS_TOTAL=12 npm run start
```

When a cap stops a full fixture slice, the CLI reports **partial** retrieval (outlook from the posts that were kept) or **incomplete** retrieval (analyst not examined, no outlook line). Handles skipped because `MAX_POSTS_TOTAL` was already used do **not** get an `unclear` outlook.

With the providers unset or set to `mock`, the CLI uses fixture posts and keyword rules. `--as-of YYYY-MM-DD` sets the analysis reference date for that invocation. When it is omitted, the CLI uses the UTC date of the invocation. `--fresh` fetches a new slice. Without `--fresh`, a matching slice already stored in this process is reused and is not fetched again.

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

The page checks `GET /api/meta` and keeps a fixture banner while both sources are the mock defaults. It has handles, a question, and a “Fetch a new slice” control. The question starts as `What is each analyst's current market outlook?`. Submitting the form calls `POST /api/analyze`. One submission is sent at a time. The page shows one card per returned report: handle, outlook, explanation, dates examined, post count, retrieval coverage, analysis-input exclusions when present, provider usage when present, and evidence. Fixture evidence is labeled as a fictional fixture link. Retrieved evidence is labeled as a retrieved post link. The page also shows the reference date, whether the slice was reused, when it was fetched, and any Desearch billing fields that were actually returned. Invalid, unknown, empty, and unexamined handles are separate status lines, with no outlook card.

While analysis is the mock rules, changing the question does not change the analysis. Server startup and `GET /api/meta` do not call Desearch or Chutes.

`POST /api/analyze` body: `{ "handles": "bullmacro,bearmacro", "question": "..." }`. Add `"fresh": true` only when the new-slice control is checked. The response includes `mode`, `question`, `postsSource`, `analysisSource`, `referenceDate`, `fetchedAt`, `reused`, `billing`, `invalidHandles`, `fetchOutcomes`, and `reports`. The API reference date is the UTC date of that submission.

## Test and typecheck

```bash
npm test
npm run typecheck
```

`npm test` runs the Node test runner over `test/`, `test/desearch/`, `test/format/`, and `test/server/`, then `vitest run --config web/vitest.config.ts` for the web UI. `npm run typecheck` checks the Node project and `web/tsconfig.json`.

## What is mocked on the default path

| Piece | Current default | When its own gates are fully on |
|-------|-----------------|-------------------|
| Post retrieval | `MockPostsFetcher` reads `src/fixtures/samplePosts.ts` | `DesearchPostsFetcher` on the shared CLI, API, and web path |
| Outlook analysis | `MockOutlookAnalyzer` keyword rules | `LlmOutlookAnalyzer` on that same path |
| Web UI | Form submits to `/api/analyze` and shows fixture report cards | The same form, with source labels for the gates that are on |

Fixture URLs use `https://fixture.x-analyst.local/...`. They are not live X links. Fixture handles: `bullmacro`, `bearmacro`, `unclearmacro`, `emptymacro` (empty list).

## Shared report path

`npm start`, `POST /api/analyze`, and the web form use one report runner. Each provider has its own gate. Unset or `mock` stays on fixtures and keyword rules. Selecting Desearch without a complete live configuration stops before any request, and so does selecting Chutes without a complete live configuration. The two can be on together or one at a time.

Desearch runs only when all of the following are set (see `.env.example`):

- `POSTS_PROVIDER=desearch`
- `DESEARCH_LIVE_ENABLED=true`
- `DESEARCH_API_KEY` set to a real key (not the placeholder `replace_me_only_when_you_are_ready`)

Chutes runs only when all of the following are set:

- `ANALYSIS_PROVIDER=chutes`
- `LLM_LIVE_ENABLED=true`
- `CHUTES_API_KEY` set to a real key (not the placeholder `replace_me_only_when_you_are_ready`)
- `LLM_MODEL=Qwen/Qwen3-32B-TEE`

`createPostsFetcherFromEnv()` returns mock fixtures when Desearch is selected but incomplete. The shared runner calls that factory with the run's env and transport, and asks it to throw for that incomplete selection, so the eligible fetcher is built in one place and an explicit incomplete selection does not become fixture posts.

Desearch is Bittensor Subnet 22. Chutes is Bittensor Subnet 64. This prototype uses those providers through their REST APIs and pays in USD. It does not access a chain, a wallet, or TAO.

Live retrieval uses **`GET https://api.desearch.ai/twitter/user/posts`**. The `Authorization` header is the raw API key (no `Bearer` prefix). The question and the selected configuration are checked before that call. A question longer than 500 characters is rejected before a paid fetch when Chutes will run. It is not shortened.

A successful fetch is also written under `data/slices/`. That folder is ignored. The file stores the posts, the fetch time, and the commit that fetched them. It does not store headers, keys, or the request. `--replay path` reads that file and does not call Desearch. Replaying with the mock analyzer makes no live call. Replaying with Chutes still calls Chutes and needs the same approval as any other live run. The report shows the original fetch time and commit. `--replay` cannot be combined with `--fresh`.

A successful slice is kept in memory for the life of the process. The cache holds one entry, the latest key and slice. Storing a different key replaces it. The key is the post source, the ordered handles, `MAX_POSTS_PER_PERSON`, `MAX_POSTS_TOTAL`, `DESEARCH_MAX_REQUESTS_PER_RUN`, `DESEARCH_MAX_REQUESTS_PER_HANDLE` (absent when unset), `LOOKBACK_DAYS`, and the analysis reference date. The report says when the slice was fetched and whether it was reused. Reused data is not described as a new fetch. `--fresh`, or `"fresh": true` from the form, fetches again. Nothing refreshes the slice on its own. A repeated analysis can still call Chutes. The cache is not a database and does not survive a restart. A failed retrieval is not stored.

The analysis reference date is the CLI `--as-of` value, or the UTC date of that CLI invocation when the flag is omitted. The API and web form use the UTC date of the submission. Fixture-only prompts say the posts are a synthetic fixture test. A Desearch run does not use that wording or a fixed test date. Fixture evidence keeps the fictional-link label. Retrieved evidence does not.

The Desearch response example nests the quoted tweet on `quote`, and that object has its own `text`. That is the field used for the quoted post. The example sentences are placeholders, so no other field is treated as the quoted post. When `is_quote_tweet` is true and `is_retweet` is false, the timeline item's own `text` is the analyst's commentary. `quote.text` is stored separately. When that quote is sent, `quote.text` is included as context, cut at 500 characters, and counted toward `LLM_INPUT_MAX_CHARS`. The prompt labels it as another account's post, context only, and tells the model never to attribute it to the analyst. A quote is excluded for empty commentary only when that own text is empty. When both flags are true, the post stays a repost and is listed as excluded with reason `retweet_and_quote`. If nothing eligible remains, the outlook is local `unclear` and Chutes is not called.

Every valid post in a Desearch response that was already fetched is kept. That does not add another request or page. Pages for each handle continue until the oldest post on a page is past `LOOKBACK_DAYS` (default 30, counted back from the analysis reference date), there is no next page, or that handle's request allowance is used up. The allowance is the run budget still remaining. A live Desearch fetch requires `DESEARCH_MAX_REQUESTS_PER_HANDLE` to be a positive integer. The allowance is the lower of that cap and the remaining run budget. If the variable is unset, empty, or malformed, the run stops before any request. Mock runs and `--replay` do not need it. A post count does not stop a further page. The report names which limit stopped the handle: the per-handle cap, or the run budget. It also names a lookback stop or a stop because there is no next page. The same post id on a later page is removed before model input is planned, and the report says how many copies were removed. An identical duplicate id inside one page is removed and included in that count. A duplicate id in the same page with different text, time, url, kind, quoted text, or media presence fails that response. Posts are ordered by parsed timestamp, newest first. Posts from the boundary page that are older than the window stay in the retrieved slice and are excluded from model input. The documented `tweets[].media` array is the only media field used. A non-empty array marks the post as having media. Item fields inside that array are not documented, so they are not read, and the media is not downloaded. The report counts those posts. The prompt tells the model which sent posts contain media it cannot see.

Eligible posts are originals and quotes with analyst commentary inside the window. They are sent newest first until `LLM_INPUT_MAX_CHARS` (default 20,000) is used up. Each analyst text is cut at 1,000 characters. A sent quote also includes `quote.text`, cut at 500 characters, in that same character budget. An eligible post that does not fit in full, and every eligible post after it, is listed with reason `beyond_input_character_budget`. Before a model call, the input ceiling plus `max_tokens` must fit in the 40,960-token context window of `Qwen/Qwen3-32B-TEE` minus a safety margin of 1,024 tokens. If it does not, the oldest eligible posts are dropped until it does, and those posts are listed with reason `beyond_context_window`. Both ceilings are recalculated after each drop. The model classifies every sent post as relevant or not, with an asset class (`equities`, `rates_bonds`, `crypto`, `commodities`, `fx`, `macro`, or `none`), a stance (`bullish`, `bearish`, `neutral`, or `unclear`), and a reason of at most 20 words and 120 characters. The model sees each sent post as an alias, `p1`, `p2`, and so on, newest first. It does not see the post id. Each alias value has `relevant`, `asset_class`, `stance`, and `reason`. A missing alias is `unclassified_by_model`. More than 10% unclassified fails that handle. Exactly 10% is allowed. An unknown alias fails that handle. Citations use the aliases, and the report maps them back to the post ids. Relevant posts are the posts classified relevant. The model also returns one overall outlook (`bullish`, `bearish`, `cautious`, `mixed`, or `unclear`) and one outlook for each asset class that has relevant posts. Each post id may appear in at most one of those outlooks, and only in the outlook for its classified asset class. A citation in two outlooks, or in the wrong asset class, fails that handle. Other handles still run. The report lists each failed handle, and the CLI exits 1 after printing the reports that succeeded. The report shows the relevant count out of the eligible posts, and the newest relevant post in each asset class. If that post is older than 14 days before the reference date, the report says that asset class's view may be stale. For each sent post, the report shows the first 100 characters of the analyst text sent. For a quote, it also shows the first 100 characters of `quote.text`, labeled separately. The date range still covers the full retrieved slice.

When Desearch returns `X-Desearch-Cost-Usd`, `X-Desearch-Usage-Count`, `X-Desearch-Service`, `X-Desearch-Currency`, or the same values on the JSON body, the report keeps those fields. A missing cost is left missing. A failed run stays failed: it does not retry and it does not present a complete report. Billing already returned, and token usage from model calls already made, are shown with that failure. Desearch failures report an HTTP status or a fixed category. They do not include the response body or the underlying exception text. The published Desearch list price is $0.15 per 1,000 posts (`DESEARCH_USD_PER_THOUSAND_POSTS`). When a response includes `usage_count`, the report also shows `list_price_usd` from that price. `list_price_usd` is not the provider-reported `cost_usd`. Confirm the account credits in the Desearch console before any live call. npm start, the API, and the web UI call Chutes when its gates are on. A live Desearch and Chutes run still needs approval before any request.

**Caps are not dollar limits.** `LOOKBACK_DAYS` bounds how far back Desearch pages are requested. `DESEARCH_MAX_REQUESTS_PER_RUN` limits **HTTP requests per run** (default 5). `DESEARCH_MAX_REQUESTS_PER_HANDLE` is required for a live Desearch fetch and limits HTTP requests for one handle. Each handle stops at the lower of that cap and the run budget still remaining. A response can still contain an undocumented number of billable posts. `MAX_POSTS_PER_PERSON` and `MAX_POSTS_TOTAL` still bound fixture retrieval. They do not stop a Desearch page. `LLM_INPUT_MAX_CHARS` bounds the text sent to the model. Copy `.env.example` to a local `.env` only when you intend to use live services. Do not commit `.env`.

## Opt-in Chutes fixture check

`npm run analyze:llm-fixture -- <handle>` still reads one fixture handle through `MockPostsFetcher`. It is separate from the shared path. It calls Chutes only when all of the following are true (see `.env.example`):

- `ANALYSIS_PROVIDER=chutes`
- `LLM_LIVE_ENABLED=true`
- `CHUTES_API_KEY` set to a real key (not the placeholder `replace_me_only_when_you_are_ready`)
- `LLM_MODEL=Qwen/Qwen3-32B-TEE`

The request goes to `https://llm.chutes.ai/v1/chat/completions` with `/no_think` and a strict JSON schema. `max_tokens` is the worst-case classification JSON for the posts actually sent: one entry per post, a 120-character reason, and each post id cited once, only in the outlook for its asset class. `Qwen/Qwen3-32B-TEE` has a 40,960-token context window. Before a call, the input ceiling plus `max_tokens` must be at most that window minus 1,024 tokens. Oldest eligible posts are dropped until the request fits. The coded rates are $0.104 per million input tokens and $0.416 per million output tokens. `$0.05` is a local budget for one later approved call. Chutes does not enforce that dollar amount. Before a request, the command prints a pessimistic ceiling: one token per UTF-8 byte of the serialized request, plus 32 tokens of framing per message, plus that output ceiling. That ceiling is not provider-reported usage. A higher estimate, or any other model name, stops before the request. A model change needs a new rate and a new estimate. A request that fills the character budget with one-character posts exceeds `$0.05` and is rejected before any call. A request that passes the `$0.05` check and still does not fit the context window is not sent.

The question is limited to 500 characters. Eligible post text is sent until `LLM_INPUT_MAX_CHARS` (default 20,000). Analyst text is cut at 1,000 characters, and quoted context at 500. The local `$0.05` check uses that serialized request and the classification output ceiling before any call. The context-window check uses those same ceilings and drops the oldest eligible posts until the input ceiling plus `max_tokens` fits. Original posts send their own text. A quote sends the analyst's own commentary plus the labeled quoted post. Reposts and quotes without that commentary are excluded and are not described as model-examined. Retrieval coverage stays the fetch result. Citation metadata is copied from the supplied posts. A refusal, a non-200 response, or `finish_reason` `length` fails the run. There is no retry, fallback, or limit increase. When a failed response includes token usage, the command prints that usage separately from the failure. Transport failures print a fixed message and do not echo the underlying error text.

Optional `--as-of YYYY-MM-DD` sets the analysis reference date used for “current”. When omitted, the command uses the UTC date of the run. The output labels the run as a synthetic fixture test, not current real-world research.

Automated tests mock the HTTP response and do not call Chutes. Do not run this command again without a separate approval.

## Limitations

- Roster is a manual handle list. No X Lists, OAuth, accounts, database, or deployment.
- Mock analysis is keyword rules, not model inference. Do not treat a mock or model report as verified market research.
- Retrieved posts are untrusted data. Reports keep author, timestamp, post id, URL, and post kind on every citation.
- Fetch reuse lasts only as long as the process and only for the same slice key. It does not skip a later Chutes call.
