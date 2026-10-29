# Chutes automatic model selection

Live analyze picks a Chutes model before the confirmation prompt. Selection uses the free catalog at `GET /v1/models` on the same origin as `CHUTES_CHAT_COMPLETIONS_URL`, then ranks eligible TEE models and caches each model’s Hugging Face `tokenizer.json` under `data/tokenizers/`.

## Preflight

- One catalog request (no API key) before `Proceed?`.
- Unpriced or incomplete catalog entries are skipped; the preflight prints how many entries were skipped (unpriced or incomplete).
- The run stops when the catalog shape is invalid or no model passes eligibility.
- Primary-model worst case summed across handles must be at most **$1.00** before confirmation.
- Preflight prints the chosen model, up to two fallback ids, and the Chutes estimate **across N handle(s)**.

## Eligibility (catalog + Hugging Face)

Each candidate must satisfy all of:

- Positive finite `pricing.prompt` and `pricing.completion`.
- `supported_features` includes `structured_outputs` and `reasoning`.
- `confidential_compute === true`.
- `context_length` ≥ input ceiling + output ceiling + 16,000 thinking allowance.
- `max_output_length` ≥ output ceiling + 16,000.
- Hugging Face model API: `gated` false, `private` false, and `tokenizer.json` in `siblings`.
- Worst-case cost per handle ≤ **$0.20** local ceiling.

## During the run

- Thinking is enabled on each Chutes request (`chat_template_kwargs.enable_thinking`).
- Before each HTTP call the app checks the **$0.20** per-call and **$1.00** run worst-case ledger (add-only; 404/503 attempts still commit). The rates are the selected catalog model's prices. A missing, zero, negative, or non-finite price stops the call before the request is sent.
- Each request waits up to **15 minutes**. A timeout is not retried and does not select a fallback model. The report records `durationMs` on each sent attempt. A timeout can still be billed by Chutes and then has no provider usage in the report.
- On HTTP 404 or 503 the app may try up to **two** fallback models that were ranked at preflight. Each fallback reloads the tokenizer, refits the context window, and re-checks both dollar limits. Models that do not fit are skipped and do not count toward the two attempts.

## Overrides

- `LLM_MODEL` forces a catalog id when it is still eligible for the run ceilings.
- Sticky state in `data/models/state.json` prefers the last successful model when it remains in the top ten.
