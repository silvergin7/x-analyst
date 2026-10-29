# Hugging Face tokenizer cache

Live `npm run analyze` downloads each selected model’s public `tokenizer.json` from Hugging Face into `data/tokenizers/` (override with `X_ANALYST_TOKENIZER_CACHE_DIR`). Token counts for preflight and per-call budgets use that file together with the model’s chat template assumptions documented in [model-input.md](model-input.md).

## When it runs

- Preflight loads the primary ranked model’s tokenizer before printing the Chutes estimate.
- Fallback attempts load the tokenizer for each alternate model before refitting the context window.

Offline `--offline` runs and unit tests inject fixture tokenizers; no cache directory is required for CI.

## Requirements

The Hugging Face model API must report `gated: false`, `private: false`, and a `tokenizer.json` sibling. Downloads are capped at 100 MB with a 60 s timeout. Checksums are stored beside the cached file so a matching commit can reuse the cache without re-downloading.

See [chutes-model-selection.md](chutes-model-selection.md) for how tokenizer loading interacts with eligibility and fallbacks.
