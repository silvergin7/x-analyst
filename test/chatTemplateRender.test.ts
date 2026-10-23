import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { renderChatTemplate } from "../src/analyze/chatTemplateRender.js";
import {
  DEFAULT_VENDOR_TOKENIZER_DIR,
  readPinnedTokenizerJson,
} from "../src/analyze/qwenTokenizerPins.js";

const vendorReady =
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer.json`) &&
  existsSync(`${DEFAULT_VENDOR_TOKENIZER_DIR}/tokenizer_config.json`);

describe("chat template render", () => {
  it("renders the pinned Qwen3 template for a fixed message pair", { skip: !vendorReady }, () => {
    const { config } = readPinnedTokenizerJson(DEFAULT_VENDOR_TOKENIZER_DIR);
    const rendered = renderChatTemplate(config.chat_template ?? "", [
      { role: "system", content: "/no_think\nSystem line for golden test." },
      { role: "user", content: "User line for golden test." },
    ]);
    assert.equal(
      rendered,
      "<|im_start|>system\n/no_think\nSystem line for golden test.<|im_end|>\n<|im_start|>user\nUser line for golden test.<|im_end|>\n<|im_start|>assistant\n",
    );
  });
});
