# X Analyst

X Analyst reads recent posts from market analysts on X (Twitter), filters noise, and builds a structured outlook report for each handle you choose. It is a local tool for one person on their own machine.

Desearch (Bittensor Subnet 22) and Chutes (Bittensor Subnet 64) are the live data and model providers. You call them through normal REST APIs and pay in US dollars. This app never connects to a chain, a wallet, or TAO.

## How it works

- **Fetch per handle.** Each analyst gets its own set of Desearch requests, newest posts first. There is no single keyword search across X.
- **Filter reposts.** Pure reposts drop out. Quote tweets keep the analyst’s own text; quoted text from someone else is labeled as context, not as the analyst’s words.
- **Classify every sent post.** The model assigns relevance, asset class, and stance to each post alias it receives. Up to 10% of posts may be left unclassified.
- **Outlooks with citations.** You get an overall outlook plus per-asset views. Each cited post ID must match a post that was actually sent.
- **Local cost and context checks.** Before each Chutes call the app estimates tokens and dollars and refuses the call if the pessimistic estimate exceeds the local ceiling or the context window budget.
- **Saved slices and JSON reports.** A slice is a saved copy of the posts fetched in one run, stored under `data/slices/` and loaded again with `--replay`. Reports are JSON files under `data/reports/` (or your override) for the web viewer and your records.

## Limits and costs

| Item | Value | Where it is defined |
|------|------:|---------------------|
| Desearch list price | $0.15 per 1,000 posts | `src/config/desearchSettings.ts` (`DESEARCH_USD_PER_THOUSAND_POSTS`) |
| Chutes input rate | $0.104 per 1M tokens | `src/config/llmSettings.ts` (`LLM_INPUT_USD_PER_MILLION`) |
| Chutes output rate | $0.416 per 1M tokens | `src/config/llmSettings.ts` (`LLM_OUTPUT_USD_PER_MILLION`) |
| Local pre-call budget check | $0.05 per Chutes request | `src/config/llmSettings.ts` (`LLM_CALL_BUDGET_USD`) |
| Desearch requests per run | Required for live runs; `.env.example` uses 5 | `src/config/desearchSettings.ts`, `.env.example` |
| Desearch requests per handle | Required for live runs; `.env.example` uses 3 | `src/config/desearchSettings.ts`, `.env.example` |
| Lookback window | 30 days | `src/config.ts` (`DEFAULT_LOOKBACK_DAYS`) |
| Post text sent to the model | 20,000 characters | `src/config/llmSettings.ts` (`LLM_INPUT_MAX_CHARS`) |
| Model context window | 40,960 tokens | `src/config/llmSettings.ts` (`LLM_CONTEXT_WINDOW_TOKENS`) |
| Context safety margin | 1,024 tokens | `src/config/llmSettings.ts` (`LLM_CONTEXT_SAFETY_MARGIN_TOKENS`) |
| Priced Chutes model | `Qwen/Qwen3-32B-TEE` | `src/config/llmSettings.ts` (`PRICED_LLM_MODEL`) |

Token counting, margins, and drop-oldest behavior: [docs/model-input.md](docs/model-input.md). Desearch request shape and preflight math: [docs/reference.md](docs/reference.md).

## Try it offline first

1. Install Node.js 20.12 or newer, then run `npm install`.
2. Run `npm run analyze -- --offline --handles bullmacro`.
3. When you see `Proceed? [y/N]`, type `y` (or add `--yes` to skip the prompt).
4. Read the printed report. Fixture handle `bullmacro` returns a mock bullish outlook with evidence links under `fixture.x-analyst.local`.

Example excerpt (trimmed):

```text
@bullmacro
  Outlook: bullish (source: mock rules, not LLM)
  Posts examined: 3
  Explanation: Mock analysis (not LLM): dominant signal is "bullish" from 2 post(s) with eligible original/commentary text. Original post expresses constructive / bullish macro language.
  Evidence:
    - b1 [original] 2026-09-20T14:00:00.000Z https://fixture.x-analyst.local/posts/bullmacro/b1
    - b2 [original] 2026-09-18T09:30:00.000Z https://fixture.x-analyst.local/posts/bullmacro/b2
```

## Getting API keys

- **Desearch:** Create an API key at [desearch.ai](https://desearch.ai). Put it in `.env` as `DESEARCH_API_KEY`. Never commit the key to the repo.
- **Chutes:** Create an API key at [chutes.ai](https://chutes.ai). Put it in `.env` as `CHUTES_API_KEY`. Never commit the key to the repo.

## Run it live

1. Copy `.env.example` to `.env` and fill in live gates (placeholders in the example file only):

| Variable | Purpose | Example in `.env.example` |
|----------|---------|---------------------------|
| `POSTS_PROVIDER` | Live post source | `desearch` |
| `DESEARCH_API_KEY` | Desearch credential | `replace_me_only_when_you_are_ready` |
| `DESEARCH_LIVE_ENABLED` | Allow Desearch fetch | `true` |
| `DESEARCH_MAX_REQUESTS_PER_RUN` | HTTP cap per run | `5` |
| `DESEARCH_MAX_REQUESTS_PER_HANDLE` | HTTP cap per handle | `3` |
| `ANALYSIS_PROVIDER` | Analysis backend | `chutes` |
| `LLM_LIVE_ENABLED` | Allow Chutes calls | `true` |
| `CHUTES_API_KEY` | Chutes credential | `replace_me_only_when_you_are_ready` |
| `LLM_MODEL` | Must match coded rates | `Qwen/Qwen3-32B-TEE` |

2. Install the pinned Qwen3 tokenizer files: [docs/tokenizer.md](docs/tokenizer.md).
3. Run `npm run analyze`. Without `--handles`, the run uses every handle listed in `config/analysts.json`; each handle is fetched and billed separately. You can pass `--handles`, `--question`, and other flags from [docs/reference.md](docs/reference.md).
4. Read the preflight summary: it lists handles, limits, provider hosts (scheme, host, and port only), and worst-case local cost estimates (not provider charges).
5. Type `y` at `Proceed? [y/N]` to send paid requests, or anything else to stop with no fetch and no model call.

Example preflight (one handle, default provider hosts, limits from `.env.example`; not provider charges):

```text
Desearch host: https://api.desearch.ai
Chutes host: https://llm.chutes.ai
Handles: bullmacro
Question: What is each analyst's current market outlook?
Analysis reference date: 2026-10-10
DESEARCH_MAX_REQUESTS_PER_RUN: 5
DESEARCH_MAX_REQUESTS_PER_HANDLE: 3
Chutes: one request per handle; model Qwen/Qwen3-32B-TEE
count query parameter: not sent on GET /twitter/user/posts
Desearch worst-case list-price estimate (not a charge): usage_count 60, list_price_usd 0.009000 (observed usage_count up to 20 per response (count not sent on the request))
Chutes worst-case local estimate (not a charge; larger of modest and long post shapes): $0.007086 summed across handles
```

- **Desearch host / Chutes host:** where API keys would be sent (scheme, host, and port only).
- **Handles:** which analysts this run covers.
- **Question:** the wording passed to the model.
- **Analysis reference date:** the UTC day used for lookback and staleness checks.
- **DESEARCH_MAX_REQUESTS_PER_RUN / DESEARCH_MAX_REQUESTS_PER_HANDLE:** the most Desearch requests this run, and each handle, may make.
- **Chutes model line:** one Chutes request per handle at the priced model name.
- **count query parameter:** whether the Desearch request includes a `count` field.
- **Desearch list-price line:** a local upper bound from caps and observed posts per response, not a Desearch charge.
- **Chutes estimate line:** a local upper bound from synthetic post shapes and token rates, not a Chutes charge.

To re-analyze a saved slice with `--replay path`, you only need Chutes live settings in `.env` (`ANALYSIS_PROVIDER`, `LLM_LIVE_ENABLED`, `CHUTES_API_KEY`). A fresh live fetch still needs the full Desearch and Chutes gates from the table above. Details: [docs/reference.md](docs/reference.md).

## View a report

1. In one terminal, run `npm run dev:server` (API on `http://127.0.0.1:3001`).
2. In a second terminal, run `npm run dev:web` and open `http://127.0.0.1:5173` in your browser.
3. Pick a saved JSON report from `data/reports/` or upload a file from an analyze run. The viewer shows classifications, exclusions, costs, and handle failures for handles that did not complete. It does not start a live fetch or model call.

## What's simplified / known limits

- You maintain the analyst list manually (`config/analysts.json` or `--handles`). There is no X List sync or OAuth.
- Posts with images are flagged; the model only sees text.
- Local estimates and list-price math are not the same as provider-reported charges on a live bill.
- Desearch requests do not send a `count` parameter, so preflight assumes up to 20 billable posts per HTTP response when estimating list price (see [docs/reference.md](docs/reference.md)).
- Offline mock analysis uses keyword rules, not the LLM.

## Run the tests

```bash
npm test
npm run typecheck
```

Tests force live providers off. A few tests need the vendor tokenizer tree and skip visibly when `vendor/qwen3-32b-fp8/` is missing.

Pull requests and pushes to `main` run `npm test` and `npm run typecheck` on GitHub Actions with live providers forced off. The tokenizer files aren't downloaded there, so tests that need them show as skipped.

## More detail

- [docs/tokenizer.md](docs/tokenizer.md): install and verify pinned tokenizer files.
- [docs/model-input.md](docs/model-input.md): token budget, margin, and context window.
- [docs/reference.md](docs/reference.md): flags, env vars, Desearch requests, and `npm run analyze:llm-fixture`.
