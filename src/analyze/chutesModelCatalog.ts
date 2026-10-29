import { readFileSync } from "node:fs";
import {
  CHUTES_CATALOG_MAX_BYTES,
  CHUTES_CATALOG_TIMEOUT_MS,
} from "../config/llmSettings.js";
import { loadChutesChatCompletionsUrl } from "../config/llmSettings.js";
import {
  providerEndpointOrigin,
  resolvedChutesOverrideUrl,
} from "../runtime/providerUrlPreflight.js";
import { BoundedBodyTooLargeError } from "./boundedHttpRead.js";
import type { ChutesCatalogTransport } from "./chutesCatalogTransport.js";

export interface ChutesModelPricing {
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
}

export interface ChutesCatalogModel {
  id: string;
  root: string;
  pricing: ChutesModelPricing;
  contextLength: number;
  maxOutputLength: number;
  supportedFeatures: readonly string[];
  confidentialCompute: boolean;
}

export class ChutesCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChutesCatalogError";
  }
}

export interface ParsedChutesCatalog {
  models: ChutesCatalogModel[];
  skippedEntryCount: number;
}

function finitePositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    out.push(item);
  }
  return out;
}

function parseCatalogEntry(raw: unknown): ChutesCatalogModel | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const id = readString(record.id);
  const root = readString(record.root);
  if (id === undefined || root === undefined) return undefined;

  const pricingRaw = record.pricing;
  if (pricingRaw === null || typeof pricingRaw !== "object" || Array.isArray(pricingRaw)) {
    return undefined;
  }
  const pricingRecord = pricingRaw as Record<string, unknown>;
  const prompt = finitePositiveNumber(pricingRecord.prompt);
  const completion = finitePositiveNumber(pricingRecord.completion);
  if (prompt === undefined || completion === undefined) return undefined;

  const contextLength = finitePositiveNumber(record.context_length);
  const maxOutputLength = finitePositiveNumber(record.max_output_length);
  if (contextLength === undefined || maxOutputLength === undefined) return undefined;

  const supportedFeatures = readStringArray(record.supported_features);
  if (supportedFeatures === undefined) return undefined;

  if (typeof record.confidential_compute !== "boolean") return undefined;

  return {
    id,
    root,
    pricing: { promptUsdPerMillion: prompt, completionUsdPerMillion: completion },
    contextLength,
    maxOutputLength,
    supportedFeatures,
    confidentialCompute: record.confidential_compute,
  };
}

export function parseChutesCatalogBody(bodyText: string): ParsedChutesCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new ChutesCatalogError("Chutes model catalog response was not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ChutesCatalogError("Chutes model catalog response had an invalid shape");
  }
  const data = (parsed as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    throw new ChutesCatalogError("Chutes model catalog response had an invalid shape");
  }
  const models: ChutesCatalogModel[] = [];
  let skippedEntryCount = 0;
  for (const entry of data) {
    const model = parseCatalogEntry(entry);
    if (model === undefined) {
      skippedEntryCount += 1;
      continue;
    }
    models.push(model);
  }
  return { models, skippedEntryCount };
}

export function chutesModelsListUrl(env: NodeJS.ProcessEnv = process.env): string {
  const origin = providerEndpointOrigin(resolvedChutesOverrideUrl(env));
  return `${origin}/v1/models`;
}

export async function fetchChutesModelCatalog(
  url: string,
  transport: ChutesCatalogTransport,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ParsedChutesCatalog> {
  const fixturePath = env.CHUTES_CATALOG_FIXTURE_PATH?.trim();
  if (fixturePath !== undefined && fixturePath !== "") {
    const bodyText = readFileSync(fixturePath, "utf8");
    if (Buffer.byteLength(bodyText, "utf8") > CHUTES_CATALOG_MAX_BYTES) {
      throw new ChutesCatalogError("Chutes model catalog response exceeded the size cap");
    }
    return parseChutesCatalogBody(bodyText);
  }
  if (url.length > CHUTES_CATALOG_MAX_BYTES) {
    throw new ChutesCatalogError("Chutes model catalog URL is too long");
  }
  const signal = AbortSignal.timeout(CHUTES_CATALOG_TIMEOUT_MS);
  let response: { status: number; bodyText: string };
  try {
    response = await transport.get(url, signal);
  } catch (err) {
    if (err instanceof BoundedBodyTooLargeError) {
      throw new ChutesCatalogError("Chutes model catalog response exceeded the size cap");
    }
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ChutesCatalogError("Chutes model catalog request timed out");
    }
    throw new ChutesCatalogError("Chutes model catalog request failed");
  }
  if (response.status !== 200) {
    throw new ChutesCatalogError(`Chutes model catalog returned HTTP ${response.status}`);
  }
  if (Buffer.byteLength(response.bodyText, "utf8") > CHUTES_CATALOG_MAX_BYTES) {
    throw new ChutesCatalogError("Chutes model catalog response exceeded the size cap");
  }
  return parseChutesCatalogBody(response.bodyText);
}

export function defaultChutesModelsListUrl(env: NodeJS.ProcessEnv): string {
  void loadChutesChatCompletionsUrl(env);
  return chutesModelsListUrl(env);
}
