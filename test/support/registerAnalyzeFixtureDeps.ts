import path from "node:path";
import { fileURLToPath } from "node:url";
import { setAnalyzeCliTransportDepsForTests } from "../../src/analyze/analyzeCliDeps.js";
import {
  createDirectoryHfModelInfoTransport,
  createFileCatalogTransport,
  createFileTokenizerDownloadTransport,
} from "./chutesFixtureTransports.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
setAnalyzeCliTransportDepsForTests({
  catalogTransport: createFileCatalogTransport(
    path.join(repoRoot, "test/fixtures/chutesModelsCatalog.json"),
  ),
  hfTransport: createDirectoryHfModelInfoTransport(path.join(repoRoot, "test/fixtures/hf")),
  hfDownloadTransport: createFileTokenizerDownloadTransport(
    path.join(repoRoot, "test/fixtures/tokenizer.json"),
  ),
});
