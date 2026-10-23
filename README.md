# x-analyst

Local-first tool: given analyst handles and a question, fetch each handle’s recent posts through Desearch, classify every eligible post with Chutes (`Qwen/Qwen3-32B-TEE`), and produce a cited outlook report per analyst.

**Normal path:** copy [`.env.example`](.env.example) to `.env`, install the pinned Qwen3 tokenizer under `vendor/qwen3-32b-fp8/`, then run **`npm run analyze`**. The command loads `.env` in code (shell variables override file values), prints a cost preflight, and asks for confirmation before any paid request.

**Offline and UI:** `npm start -- --offline` runs fixture posts and keyword rules only. `npm run dev:server` and `npm run dev:web` open a **saved-report viewer** for JSON written by `npm run analyze`; the browser never starts a live fetch or model call.

Both providers are Bittensor subnets used through REST APIs paid in USD. This app does not access a chain, a wallet, or TAO.

## Requirements

- Node.js **20.12+**

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

Input tokens use the official `chat_template` from `tokenizer_config.json` (rendered with `@huggingface/jinja`), plus the strict `response_format` JSON counted separately (conservative). A calibration margin is added on top of message tokens: **`max(128, ceil(0.02 × messageTokens))`**. The context-window check still reserves **1,024** tokens below the 40,960 window. Output `max_tokens` uses a byte pessimistic worst-case JSON ceiling plus tokenized empty `<think>` wrapper text. Run 7 on `ddcd255` reported **4,763 prompt tokens** on LynAldenContact with the current prompt format; post count for that run is unknown, so treat that figure as a scale check only.

## Analyst roster

Live `npm run analyze` reads [`config/analysts.json`](config/analysts.json) when `--handles` is omitted. Override the path with `ANALYST_LIST_PATH`. `--handles` overrides the file with the same validation rules (including duplicate rejection).

## Live analyze

```bash
npm run analyze
```

Defaults: question **`What is each analyst's current market outlook?`**, analysis reference date **UTC today**. Both appear in the preflight summary.

Flags:

- **`--offline`** — mock posts and mock analysis (tests and local checks).
- **`--yes`** — skip the `Proceed? [y/N]` prompt (use only when an approved live run names it).
- **`--replay path`** — analyze a saved slice without Desearch ($0 fetch in preflight).
- **`--output path`** — JSON report path (default under `data/reports/`).
- **`--handles a,b`**, **`--question "..."`**, **`--as-of YYYY-MM-DD`**, **`--fresh`**.

Missing or malformed `.env` keys stop the run before any request when not using `--offline`.

## Offline CLI

```bash
npm start -- --offline
```

Without **`--offline`**, `npm start` exits with an error and points to `npm run analyze`.

Offline runs use fixture handles only when you pass **`--handles`**; otherwise the roster comes from `config/analysts.json`.

## Web report viewer

```bash
npm run dev:server
npm run dev:web
```

Open reports saved under `data/reports/` or upload a JSON file from an `npm run analyze` run. The API exposes `GET /api/reports` and `GET /api/reports/<basename>.json` only (no arbitrary paths, no live analysis).

## Test and typecheck

```bash
npm test
npm run typecheck
```

Tests force live providers off. Vendor-only tests (chat-template golden string and 31/48/55 fit tables) run when `vendor/qwen3-32b-fp8/` matches the pinned checksums; otherwise they are **skipped**, not passed.

## Pipeline summary

Desearch: **`GET https://api.desearch.ai/twitter/user/posts`**. The current request builder sends `username` and optional `cursor` only (**`count` is not sent**). Preflight Desearch list-price worst case uses planned HTTP requests per handle times **`max(count sent, 20)`**, with **20** labeled as the observed maximum `usage_count` per response (not a documented API default).

Chutes: one request per handle, strict JSON schema, `/no_think`, local **$0.05** pre-call estimate, context window **40,960 − 1,024** including `max_tokens`. Provider-reported charges stay separate from local estimates.

Slices save under `data/slices/` for `--replay`. See earlier sections in this file for post handling, classification, citations, and limits (`DESEARCH_MAX_REQUESTS_PER_RUN`, `DESEARCH_MAX_REQUESTS_PER_HANDLE`, `LLM_INPUT_MAX_CHARS`, lookback, and failure isolation).

## Opt-in Chutes fixture check

`npm run analyze:llm-fixture -- <handle>` remains a separate fixture-only Chutes smoke path. Do not run it live without explicit approval.

## Limitations

- Manual roster; no X Lists, OAuth, accounts, database, or deployment.
- Mock analysis is keyword rules, not model inference.
- Retrieved posts are untrusted data; reports keep traceable citations.
