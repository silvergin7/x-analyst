# Model input, token budget, and context window

This page describes how X Analyst builds a Chutes request and the local checks that run before a paid model call. Dollar figures in the app are estimates unless the provider returns a charge field in a live response.

## Token counting

For live Chutes runs, input size uses the selected model’s cached Hugging Face `tokenizer.json` (see [chutes-model-selection.md](chutes-model-selection.md)).

The local upper bound includes:

1. **Message tokens:** rendered chat messages for the question, reference date, and posts (with local aliases `p1`, `p2`, …).
2. **Response format tokens:** the strict JSON schema block is tokenized separately and added to the input ceiling (conservative).
3. **Calibration margin:** on top of message tokens: `max(128, ceil(0.02 × messageTokens))`. Constants live in `src/config/llmSettings.ts` (`LLM_TOKENIZER_CALIBRATION_FIXED`, `LLM_TOKENIZER_CALIBRATION_RATIO`); logic in `src/analyze/tokenBudget.ts`.

Output side uses a pessimistic JSON byte ceiling plus tokenized empty thinking wrapper text for budget math (`src/analyze/outputBudget.ts`).

## Dollar check before each Chutes call

Before HTTP, the app compares the pessimistic estimate to **$0.20** per call (`LLM_CALL_BUDGET_USD`) and **$1.00** committed worst case per run (`LLM_RUN_BUDGET_USD`). Rates come from the selected catalog model. Output budgeting reserves **16,000** thinking tokens (`LLM_THINKING_ALLOWANCE_TOKENS`).

Provider-reported `cost_usd` or token usage from a response is shown separately and is not replaced by the local estimate.

## Character budget for posts

Eligible post text is packed newest-first up to **20,000** characters total (`LLM_INPUT_MAX_CHARS`). Each post is cut at **1,000** characters (`LLM_MAX_POST_CHARS`) before counting toward that total. Posts that do not fit are listed in the report with a reason.

## Context window and drop-oldest

The context window is the selected model's catalog context length. The sent `max_tokens` is the JSON output ceiling plus the 16,000 thinking tokens, and the context fit uses that total once. The app requires the input ceiling plus that `max_tokens` to fit in **window − 1,024** (`LLM_CONTEXT_SAFETY_MARGIN_TOKENS`).

If the request is still too large, the oldest eligible posts are dropped and listed as `beyond_context_window` (`src/analyze/fitContextWindow.ts`). That happens before the HTTP call.

## Preflight worst-case (live analyze)

Before you confirm a live run, the CLI prints a summed **worst-case local estimate** across handles using synthetic modest and long post shapes and taking the larger per handle (`src/analyzePreflight.ts`). That is not a provider charge.

Desearch list-price preflight uses a separate formula; see [reference.md](reference.md).

## Post classifications and citations

The model must classify every sent post alias. Up to **10%** may be left unclassified (`unclassified_by_model`). Invalid per-post rows (empty reason, overlong reason, or relevant with `asset_class: none`) are stored as **`classification_invalid`**; both invalid and unclassified counts apply toward that cap.

Citation checks drop evidence tied to **`classification_invalid`** or **`unclassified_by_model`** posts and may drop an asset outlook when only those posts were cited. The handle still **fails** if an asset outlook names a class with **no model-relevant posts**, if a non-unclear outlook cites **no post IDs**, or if evidence is empty for reasons other than dropped invalid/unclassified citations. Overlong explanations are truncated (`explanationTruncated` in the report).
