import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFetchHuggingFaceModelInfoTransport } from "../src/analyze/huggingfaceModelInfoTransport.js";
import { huggingFaceModelApiUrl } from "../src/analyze/huggingfaceModelApiUrl.js";

describe("Hugging Face model info transport", () => {
  it("builds owner/name API URLs without encoding the slash", () => {
    assert.equal(
      huggingFaceModelApiUrl("zai-org/GLM-5.2"),
      "https://huggingface.co/api/models/zai-org/GLM-5.2",
    );
  });

  it("requests the exact API URL through fetch", async () => {
    let requestedUrl = "";
    const transport = createFetchHuggingFaceModelInfoTransport(async (url) => {
      requestedUrl = typeof url === "string" ? url : url.toString();
      return new Response(
        JSON.stringify({
          sha: "a".repeat(40),
          gated: false,
          private: false,
          siblings: [{ rfilename: "tokenizer.json" }],
        }),
        { status: 200 },
      );
    });
    const info = await transport.fetchModelInfo("zai-org/GLM-5.2");
    assert.ok(info !== null);
    assert.equal(requestedUrl, "https://huggingface.co/api/models/zai-org/GLM-5.2");
  });
});
