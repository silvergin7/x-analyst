import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseHuggingFaceModelInfoBody,
  type HuggingFaceModelInfo,
  type HuggingFaceModelInfoTransport,
} from "./huggingfaceModelInfo.js";
import { CHUTES_MODEL_ROOT_PATTERN } from "./chutesModelEligibility.js";

function fileFixtureTransport(fixtureDir: string): HuggingFaceModelInfoTransport {
  return {
    async fetchModelInfo(root: string): Promise<HuggingFaceModelInfo | null> {
      const safeRoot = root.replaceAll("/", "__");
      const filePath = path.join(fixtureDir, `${safeRoot}.json`);
      try {
        const body = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
        return parseHuggingFaceModelInfoBody(body);
      } catch {
        return null;
      }
    },
  };
}

export function createHuggingFaceModelInfoTransport(
  env: NodeJS.ProcessEnv = process.env,
): HuggingFaceModelInfoTransport {
  const fixtureDir = env.HF_MODEL_INFO_FIXTURE_DIR?.trim();
  if (fixtureDir !== undefined && fixtureDir !== "") {
    return fileFixtureTransport(fixtureDir);
  }
  return createFetchHuggingFaceModelInfoTransport();
}

export function createFetchHuggingFaceModelInfoTransport(): HuggingFaceModelInfoTransport {
  return {
    async fetchModelInfo(root: string): Promise<HuggingFaceModelInfo | null> {
      if (!CHUTES_MODEL_ROOT_PATTERN.test(root) || root.includes("..")) {
        return null;
      }
      const url = `https://huggingface.co/api/models/${encodeURIComponent(root)}`;
      const response = await fetch(url, { method: "GET" });
      if (response.status !== 200) return null;
      try {
        const body = (await response.json()) as unknown;
        return parseHuggingFaceModelInfoBody(body);
      } catch {
        return null;
      }
    },
  };
}
