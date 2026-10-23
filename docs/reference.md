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
| `--env-file path` | Env file to load for live runs (default `.env` in the repo root). |

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
| `LLM_MODEL` | Must be `Qwen/Qwen3-32B-TEE` for the coded rate table. |
| `LLM_INPUT_MAX_CHARS` | Character budget for post text sent to the model (default 20,000). |
| `ANALYST_LIST_PATH` | JSON roster when `--handles` is omitted on analyze. |
| `LLM_TOKENIZER_DIR` | Optional override directory for pinned tokenizer files. |
| `DESEARCH_API_BASE` | Optional Desearch API base URL (default `https://api.desearch.ai`). Preflight prints **scheme, host, and port only**. A non-default origin prints a warning that your API key will be sent there. Overrides must be `http` or `https` with no userinfo, query, or fragment. Non-default origins must use **https** unless the hostname is exactly `localhost` or `127.0.0.1`. |
| `CHUTES_CHAT_COMPLETIONS_URL` | Optional Chutes chat completions URL (default `https://llm.chutes.ai/v1/chat/completions`). Same preflight origin, warning, and HTTPS rules as `DESEARCH_API_BASE`. |
| `X_ANALYST_SLICE_DIR` | Directory for saved fetch slices (default `data/slices`). |
| `X_ANALYST_REPORTS_DIR` | Directory for JSON reports (default `data/reports`). |

## Desearch HTTP request shape

Live fetch uses **GET** `https://api.desearch.ai/twitter/user/posts` (or `DESEARCH_API_BASE`) with query parameters **`username`** and optional **`cursor`**. The builder does **not** send **`count`** (`src/fetch/desearch/buildRequest.ts`).

Pagination stops on lookback, request budgets, or no further cursor. Every valid post in a paid response is kept; duplicate IDs are removed.

## Provider URL overrides and transport

- **Desearch transport** (`src/fetch/desearch/httpTransport.ts`): uses `node:https.request`. Request URLs must use **`https:`**; an `http://` base fails at fetch time with “Desearch request URL must use https:”.
- **Chutes transport** (`src/analyze/chutesClient.ts`): uses `fetch(url)` with the configured completions URL. **`http://` is allowed** (tests use `http://127.0.0.1:9`).
- Preflight compares overrides to defaults by **origin** (scheme + host + port), so the default Chutes path does not count as a custom host.

## Desearch preflight list-price worst case

Before confirmation on a live non-replay run, the CLI prints a **list-price** estimate (not `cost_usd` from a response):

- Planned HTTP requests per handle (min of per-handle cap and run budget).
- Posts per request: **`max(count sent, 20)`**; when `count` is not sent, **20** is used as the observed maximum `usage_count` per response (`src/runtime/desearchPreflight.ts`, `DESEARCH_OBSERVED_MAX_POSTS_PER_RESPONSE`).
- Price: **$0.15 per 1,000 posts** (`DESEARCH_USD_PER_THOUSAND_POSTS`).

## `npm run analyze:llm-fixture`

Separate script (`src/llmFixtureCheck.ts`) that runs the Chutes path against fixture posts for one handle when live gates and the local budget pass. It prints the local estimate before usage. Use it only when you intend to spend on that single fixture call.

## Related docs

- [tokenizer.md](tokenizer.md): install pinned files.
- [model-input.md](model-input.md): token math and context fit.
