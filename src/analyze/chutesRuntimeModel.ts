import type { ChutesCatalogModel } from "./chutesModelCatalog.js";
import type { LlmRuntimeConfig } from "../config/llmSettings.js";
import type { TokenizerPin } from "../types.js";
import type { TokenizerRuntime } from "./tokenizerRuntime.js";
import { getTokenizerRuntime } from "./tokenizerRuntime.js";

export interface ChutesRunModelBinding {
  catalogModel: ChutesCatalogModel;
  runtimeConfig: LlmRuntimeConfig;
  tokenizerJsonPath: string;
  tokenizerPin: TokenizerPin;
  tokenizerRuntime: TokenizerRuntime;
}

export type MutableChutesRunBinding = { current?: ChutesRunModelBinding };

export function chutesRuntimeConfigFromCatalogModel(
  model: ChutesCatalogModel,
  chatCompletionsUrl: string,
  apiKey: string,
): LlmRuntimeConfig {
  return {
    provider: "chutes",
    liveEnabled: true,
    apiKey,
    model: model.id,
    chatCompletionsUrl,
    modelPricing: model.pricing,
    contextLengthTokens: model.contextLength,
    eligible: true,
  };
}

export function tokenizerRuntimeFromPath(jsonPath: string): TokenizerRuntime {
  return getTokenizerRuntime({ CHUTES_TOKENIZER_JSON_PATH: jsonPath });
}
