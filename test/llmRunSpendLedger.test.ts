import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { LlmCallError, requestChutesCompletion } from "../src/analyze/chutesClient.js";
import { LlmRunSpendLedger } from "../src/analyze/llmRunSpendLedger.js";
import { LLM_RUN_BUDGET_USD } from "../src/config/llmSettings.js";
import { DEFAULT_CHUTES_CHAT_COMPLETIONS_URL } from "../src/config/llmSettings.js";
import type { LlmRuntimeConfig } from "../src/config/llmSettings.js";
import { testLlmRuntimeFields, withTestChutesModelEnv } from "./support/chutesTestModel.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";

function liveConfig(): LlmRuntimeConfig {
  return {
    provider: "chutes",
    liveEnabled: true,
    apiKey: "test-key",
    chatCompletionsUrl: DEFAULT_CHUTES_CHAT_COMPLETIONS_URL,
    eligible: true,
    ...testLlmRuntimeFields(),
  };
}

describe("LLM run spend ledger", () => {
  it("only adds committed estimates and never subtracts", () => {
    const ledger = new LlmRunSpendLedger();
    ledger.recordCommittedEstimate(0.4);
    ledger.recordCommittedEstimate(0.3);
    assert.equal(ledger.totalCommittedUsd, 0.7);
    assert.equal(ledger.wouldExceedRunBudget(0.2), false);
    assert.equal(ledger.wouldExceedRunBudget(0.300001), true);
  });

  it("mutation: a committed estimate is not reversed when a later check fails", () => {
    const ledger = new LlmRunSpendLedger();
    ledger.recordCommittedEstimate(LLM_RUN_BUDGET_USD);
    assert.equal(ledger.wouldExceedRunBudget(0.000001), true);
    assert.equal(ledger.totalCommittedUsd, LLM_RUN_BUDGET_USD);
  });

  it("records a 404 attempt before rejecting the response", async () => {
    installByteQuarterMockTokenizer();
    const env = withTestChutesModelEnv(process.env);
    const ledger = new LlmRunSpendLedger();
    const transport = {
      async post() {
        return { status: 404, bodyText: "missing model" };
      },
    };
    await assert.rejects(
      () =>
        requestChutesCompletion(
          liveConfig(),
          [
            { role: "system", content: "sys" },
            { role: "user", content: "user" },
          ],
          transport,
          env,
          100,
          [],
          undefined,
          ledger,
        ),
      (err: unknown) => err instanceof LlmCallError && err.code === "http",
    );
    assert.ok(ledger.totalCommittedUsd > 0);
    clearMockTokenizer();
  });
});
