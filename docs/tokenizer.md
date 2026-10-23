# Qwen3 tokenizer (local install)

Live `npm run analyze` runs a local token budget before each Chutes call. The app counts input tokens with the same Qwen3 chat template and tokenizer files used for the priced model path. It does not download these files for you.

## Why it is required

Without the pinned files under `vendor/qwen3-32b-fp8/`, a live run stops before preflight output with a clear error. Offline `--offline` runs and tests that mock the tokenizer do not need the vendor tree.

## Install steps

From the repository root:

```bash
mkdir -p vendor/qwen3-32b-fp8
REV=aa55da1ecc13d006e8b8e4f54579b1ea8c3db2df
HF_REPO=Qwen/Qwen3-32B-FP8
URL_JSON="https://huggingface.co/${HF_REPO}/resolve/${REV}/tokenizer.json"
URL_CFG="https://huggingface.co/${HF_REPO}/resolve/${REV}/tokenizer_config.json"
curl -fL -o vendor/qwen3-32b-fp8/tokenizer.json "${URL_JSON}"
curl -fL -o vendor/qwen3-32b-fp8/tokenizer_config.json "${URL_CFG}"
sha256sum vendor/qwen3-32b-fp8/*
```

Expected checksums (from `src/analyze/qwenTokenizerPins.ts`):

| File | SHA-256 |
|------|---------|
| `tokenizer.json` | `aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4` |
| `tokenizer_config.json` | `d5d09f07b48c3086c508b30d1c9114bd1189145b74e982a265350c923acd8101` |

The app also checks byte sizes (11,422,654 and 9,732). Set `LLM_TOKENIZER_DIR` to another directory only if the same files and checksums are present there.

See also [model-input.md](model-input.md) for how those tokens feed the cost and context checks.
