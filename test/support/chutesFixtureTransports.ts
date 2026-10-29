import { readFileSync } from "node:fs";
import path from "node:path";
import type { ChutesCatalogTransport } from "../../src/analyze/chutesCatalogTransport.js";
import { parseHuggingFaceModelInfoBody } from "../../src/analyze/huggingfaceModelInfo.js";
import type { HuggingFaceModelInfoTransport } from "../../src/analyze/huggingfaceModelInfo.js";
import type { HuggingFaceDownloadTransport } from "../../src/analyze/huggingfaceTokenizerDownload.js";

export function createFileCatalogTransport(fixturePath: string): ChutesCatalogTransport {
  return {
    async get() {
      return { status: 200, bodyText: readFileSync(fixturePath, "utf8") };
    },
  };
}

export function createDirectoryHfModelInfoTransport(fixtureDir: string): HuggingFaceModelInfoTransport {
  return {
    async fetchModelInfo(root: string) {
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

export function createFileTokenizerDownloadTransport(fixturePath: string): HuggingFaceDownloadTransport {
  return {
    async get() {
      return { status: 200, body: readFileSync(fixturePath) };
    },
  };
}
