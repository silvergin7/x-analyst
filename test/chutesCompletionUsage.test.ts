import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { LlmCallError, requestChutesCompletion } from "../src/analyze/chutesClient.js";
import { EMPTY_GEMMA_THINKING_BLOCK } from "../src/analyze/modelCompletionText.js";
import type { LlmRuntimeConfig } from "../src/config/llmSettings.js";
import { DEFAULT_CHUTES_CHAT_COMPLETIONS_URL } from "../src/config/llmSettings.js";
import { testLlmRuntimeFields, withTestChutesModelEnv } from "./support/chutesTestModel.js";
import { clearMockTokenizer, installByteQuarterMockTokenizer } from "./support/mockQwenTokenizer.js";

function recordingTransport(body: unknown) {
  const calls: unknown[] = [];
  return {
    calls,
    transport: {
      async post(_url: string, request: { body: string }) {
        calls.push(JSON.parse(request.body));
        return { status: 200, bodyText: JSON.stringify(body) };
      },
    },
  };
}

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

describe("Chutes completion handling with thinking on", () => {
  beforeEach(() => {
    installByteQuarterMockTokenizer();
    withTestChutesModelEnv(process.env);
  });
  afterEach(() => clearMockTokenizer());

  it("reads reasoning_tokens when completion_tokens_details is present", async () => {
    const json = '{"outlook":"unclear","explanation":"x","posts":{},"assetOutlooks":[]}';
    const recorded = recordingTransport({
      choices: [
        {
          finish_reason: "stop",
          message: { content: `${EMPTY_GEMMA_THINKING_BLOCK}${json}` },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        completion_tokens_details: { reasoning_tokens: 7 },
      },
    });
    const result = await requestChutesCompletion(
      liveConfig(),
      [
        { role: "system", content: "sys" },
        { role: "user", content: "user" },
      ],
      recorded.transport,
      process.env,
      100,
      [],
    );
    assert.equal(result.providerUsage?.reasoningTokens, 7);
    assert.ok(recorded.calls.length === 1);
    const body = recorded.calls[0] as { chat_template_kwargs?: { enable_thinking?: boolean } };
    assert.equal(body.chat_template_kwargs?.enable_thinking, true);
  });

  it("still fails finish_reason length with thinking enabled", async () => {
    const recorded = recordingTransport({
      choices: [
        {
          finish_reason: "length",
          message: { content: `${EMPTY_GEMMA_THINKING_BLOCK}{` },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    await assert.rejects(
      () =>
        requestChutesCompletion(
          liveConfig(),
          [
            { role: "system", content: "sys" },
            { role: "user", content: "user" },
          ],
          recorded.transport,
          process.env,
          100,
          [],
        ),
      (err: unknown) => err instanceof LlmCallError && err.code === "length",
    );
  });
});
