# Reference: commands, env, and Desearch requests

## `npm run analyze` flags

Parsed in `src/cliArgs.ts` (analyze entry uses strict handle parsing and does not default to fixture handles when `--handles` is omitted).

| Flag | Purpose |
|------|---------|
| `--offline` | Fixture posts and mock keyword analysis; no live providers. |
| `--yes` | Skip the `Proceed? [y/N]` prompt (non-TTY runs need this or they stop). |
| `--handles a,b` | Comma-separated handles. Without it, `npm run analyze` uses `config/analysts.json`. Offline runs only know the fixture handles, so always pass fixture handles with `--offline`: `bullmacro`, `bearmacro`, `unclearmacro`, `emptymacro` (from `src/fixtures/samplePosts.ts`). |
| `--question "..."` | Question text; default `What is each analyst's current market outlook?` when omitted. |
| `--as-of YYYY-MM-DD` | Analysis reference date (UTC calendar day). |
| `--fresh` | Skip the in-memory fetch cache and call Desearch again. Each `npm run analyze` starts a new process with an empty cache, so the first fetch in that run is the same with or without `--fresh`. The flag matters when the same Node process runs more than one fetch with the same cache key (see tests). |
| `--replay path` | Analyze a saved slice file without calling Desearch. Requires only Chutes live settings in `.env` (not Desearch). |
| `--output path` | JSON report path; default under `data/reports/` (or `X_ANALYST_REPORTS_DIR`). |
| `--env-file path` | Env file for live runs (default `.env` in the repo root). With `--offline`, an explicit path is loaded before mock overrides so you can test config gates without live providers. |

Live runs load `.env` in code. Shell variables already set override values from the file.

**Fresh live fetch** (no `--replay`) needs Desearch and Chutes gates: `POSTS_PROVIDER=desearch`, `DESEARCH_LIVE_ENABLED=true`, `DESEARCH_API_KEY`, request limits, `ANALYSIS_PROVIDER=chutes`, `LLM_LIVE_ENABLED=true`, and `CHUTES_API_KEY`.

**Replay** (`--replay path`, without `--offline`) needs only **`ANALYSIS_PROVIDER=chutes`**, **`LLM_LIVE_ENABLED=true`**, and a non-empty **`CHUTES_API_KEY`**. Desearch variables are not required at the CLI gate; before analysis the run clears `DESEARCH_API_KEY` and sets `DESEARCH_LIVE_ENABLED=false` in the process env passed to `runReport`.

## `npm start`

`npm start` without `--offline` exits and tells you to use `npm run analyze` for live providers.

```bash
npm start -- --offline --handles bullmacro --question "What is the outlook?"
```

Uses mock fixtures and mock rules like `npm run analyze -- --offline`.

## Environment variables

Committed template: `.env.example`. Placeholders only; never commit real keys.

| Variable | Role |
|----------|------|
| `POSTS_PROVIDER` | `desearch` for live fetch; mock path uses `--offline`. |
| `DESEARCH_API_KEY` | Raw Authorization value for Desearch (not `Bearer`). |
| `DESEARCH_LIVE_ENABLED` | Must be `true` with provider and key for live fetch. |
| `DESEARCH_MAX_REQUESTS_PER_RUN` | Required positive integer for live non-replay runs. |
| `DESEARCH_MAX_REQUESTS_PER_HANDLE` | Required positive integer for live non-replay runs. |
| `LOOKBACK_DAYS` | Days before the reference date to keep paginating (default 30 in code when unset or malformed). |
| `MAX_POSTS_PER_PERSON` / `MAX_POSTS_TOTAL` | Mock fetcher caps; not the Desearch stop rule. |
| `ANALYSIS_PROVIDER` | `chutes` for the LLM path when live. |
| `LLM_LIVE_ENABLED` | Must be `true` with provider and key for Chutes. |
| `CHUTES_API_KEY` | Bearer token for Chutes. |
| `LLM_MODEL` | Optional catalog id override when it still passes eligibility for the run. |
| `LLM_INPUT_MAX_CHARS` | Character budget for post text sent to the model (default 20,000 when unset; malformed non-empty values stop the run). |
| Chutes request timeout | Coded as `LLM_REQUEST_TIMEOUT_MS` (900 seconds, 15 minutes) in `src/config/llmSettings.ts`; one attempt, no retry, and no fallback model when the call times out. |
| `ANALYST_LIST_PATH` | JSON roster when `--handles` is omitted on analyze. |
| `LLM_TOKENIZER_DIR` | Optional override directory for pinned tokenizer files. |
| `DESEARCH_API_BASE` | Optional Desearch API base URL (default `https://api.desearch.ai`). Preflight prints **scheme, host, and port only**. A non-default origin prints a warning that your API key will be sent there. Overrides must be `http` or `https` with no userinfo, query, or fragment. Non-default origins must use **https** unless the hostname is exactly `localhost` or `127.0.0.1`. |
| `CHUTES_CHAT_COMPLETIONS_URL` | Optional Chutes chat completions URL (default `https://llm.chutes.ai/v1/chat/completions`). Same preflight origin, warning, and HTTPS rules as `DESEARCH_API_BASE`. |
| `X_ANALYST_SLICE_DIR` | Directory for saved fetch slices (default `data/slices`). |
| `X_ANALYST_REPORTS_DIR` | Directory for JSON reports (default `data/reports`). |

## Desearch HTTP request shape

Live fetch uses **GET** `https://api.desearch.ai/twitter/user/posts` (or `DESEARCH_API_BASE`) with query parameters **`username`** and optional **`cursor`**. The builder does **not** send **`count`** (`src/fetch/desearch/buildRequest.ts`).

Pagination stops on lookback, request budgets, or no further cursor. Every valid post in a paid response is kept; duplicate IDs are removed. Items that fail field checks are skipped and counted per handle (`invalidPostsSkipped`). A page that returns items but none of them valid stops that handle as incomplete (`desearch_page_no_valid_posts`). A Desearch error on the first page for a handle is recorded as `retrieval_failed` and other handles still run; a later-page error keeps partial posts on an **`ok`** outcome with `incompleteReason: desearch_retrieval_interrupted`, plus `failureCategory`, optional `httpStatus`, and `reason` describing the halt. Slices are saved whenever a fetch completes, including when some handles failed.

**CLI exit code (fetch):** exit **1** when any handle is `retrieval_failed`, `incomplete` with `desearch_page_no_valid_posts`, or **`ok`** with `incompleteReason` of `desearch_retrieval_interrupted` or `desearch_page_no_valid_posts`. Run or per-handle **request budget exhaustion** stays exit **0**.

## Provider URL overrides and transport

- **Desearch transport** (`src/fetch/desearch/httpTransport.ts`): uses `node:https.request`. Request URLs must use **`https:`**; an `http://` base fails at fetch time with “Desearch request URL must use https:”.
- **Chutes transport** (`src/analyze/chutesClient.ts`): uses the pinned `undici` `fetch` with the configured completions URL. **`http://` is allowed** (tests use `http://127.0.0.1:9`). Each call uses its own dispatcher, and that dispatcher's header and body timeouts are the same value as the request timeout.
- Preflight compares overrides to defaults by **origin** (scheme + host + port), so the default Chutes path does not count as a custom host.

## Preflight output by mode

- **`--offline`:** seven lines only — handles, question, reference date, both Desearch limit labels (`not required offline`), `Desearch: not used (offline)`, `Chutes: not used (offline)`. No hosts, model line, count line, or cost estimates. **`--offline --replay`** uses the same block.
- **`--replay` (without `--offline`):** the slice is loaded first. Handles that do not match the run, or a slice with no usable posts, stop before the preflight text and before `Proceed?`, and the message ends with `No request was sent.` Otherwise: Chutes host (origin only), handles, question, reference date, both limit labels (`not required for replay`), Chutes model line, `Desearch: not used (replay), $0.000000`, then the Chutes worst-case local estimate. Each handle uses its saved usable post count (posts on an ok outcome; any other outcome counts as zero and adds $0). Model eligibility uses the largest of those counts. No Desearch host, count line, or list-price math.
- **Live fetch:** provider warnings (non-default origins), both hosts, limits, count-on-wire note, Desearch list-price worst case, Chutes worst-case estimate.

## Desearch preflight list-price worst case

Before confirmation on a live non-replay run, the CLI prints a **list-price** estimate (not `cost_usd` from a response):

- Planned HTTP requests per handle (min of per-handle cap and run budget).
- Posts per request: **`max(count sent, 20)`**; when `count` is not sent, **20** is used as the observed maximum `usage_count` per response (`src/runtime/desearchPreflight.ts`, `DESEARCH_OBSERVED_MAX_POSTS_PER_RESPONSE`).
- Price: **$0.15 per 1,000 posts** (`DESEARCH_USD_PER_THOUSAND_POSTS`).

A timed-out Chutes call can still be billed by Chutes. The report then has no provider usage for that call, because usage arrives only with a completed response. Each sent attempt records `durationMs` on `llmModelAttempts` when the HTTP call started. Older reports omit that field and still load.

## `npm run analyze:llm-fixture`

Separate script (`src/llmFixtureCheck.ts`) that runs the Chutes path against fixture posts for one handle when live gates and the local budget pass. It prints the local estimate before usage. Use it only when you intend to spend on that single fixture call.

## Related docs

- [tokenizer.md](tokenizer.md): install pinned files.
- [model-input.md](model-input.md): token math and context fit.
