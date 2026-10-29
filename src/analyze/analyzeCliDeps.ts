import type { ChutesCatalogTransport } from "./chutesCatalogTransport.js";
import type { HuggingFaceModelInfoTransport } from "./huggingfaceModelInfo.js";
import type { HuggingFaceDownloadTransport } from "./huggingfaceTokenizerDownload.js";

export interface AnalyzeCliTransportDeps {
  catalogTransport?: ChutesCatalogTransport;
  hfTransport?: HuggingFaceModelInfoTransport;
  hfDownloadTransport?: HuggingFaceDownloadTransport;
}

const GLOBAL_KEY = "__X_ANALYST_ANALYZE_CLI_DEPS__";

function globalDepsStore(): Record<string, AnalyzeCliTransportDeps | undefined> {
  return globalThis as unknown as Record<string, AnalyzeCliTransportDeps | undefined>;
}

export function readAnalyzeCliTransportDeps(): AnalyzeCliTransportDeps {
  return globalDepsStore()[GLOBAL_KEY] ?? {};
}

export function setAnalyzeCliTransportDepsForTests(deps: AnalyzeCliTransportDeps): void {
  globalDepsStore()[GLOBAL_KEY] = deps;
}

export function clearAnalyzeCliTransportDepsForTests(): void {
  delete globalDepsStore()[GLOBAL_KEY];
}
