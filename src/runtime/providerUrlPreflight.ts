import {
  DEFAULT_CHUTES_CHAT_COMPLETIONS_URL,
} from "../config/llmSettings.js";
import { DEFAULT_DESEARCH_API_BASE } from "../fetch/desearch/buildRequest.js";

export type ProviderOverrideField = "DESEARCH_API_BASE" | "CHUTES_CHAT_COMPLETIONS_URL";

export class ProviderOverrideUrlError extends Error {
  readonly field: ProviderOverrideField;

  constructor(field: ProviderOverrideField, message: string) {
    super(message);
    this.name = "ProviderOverrideUrlError";
    this.field = field;
  }
}

function trimOverride(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function parseProviderOverrideUrl(
  raw: string,
  field: ProviderOverrideField,
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderOverrideUrlError(field, `${field} is invalid`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProviderOverrideUrlError(field, `${field} is invalid`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new ProviderOverrideUrlError(field, `${field} is invalid`);
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ProviderOverrideUrlError(field, `${field} is invalid`);
  }
  return url;
}

export function providerEndpointOrigin(url: URL): string {
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  const port = url.port;
  if (port === "" || port === defaultPort) {
    return `${url.protocol}//${url.hostname}`;
  }
  return `${url.protocol}//${url.hostname}:${port}`;
}

export function isLoopbackProviderHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function defaultOriginFor(defaultUrlString: string): string {
  return providerEndpointOrigin(new URL(defaultUrlString));
}

export function resolvedDesearchOverrideUrl(env: NodeJS.ProcessEnv): URL {
  const raw = trimOverride(env.DESEARCH_API_BASE);
  if (raw === undefined) {
    return new URL(DEFAULT_DESEARCH_API_BASE);
  }
  return parseProviderOverrideUrl(raw, "DESEARCH_API_BASE");
}

export function resolvedChutesOverrideUrl(env: NodeJS.ProcessEnv): URL {
  const raw = trimOverride(env.CHUTES_CHAT_COMPLETIONS_URL);
  if (raw === undefined) {
    return new URL(DEFAULT_CHUTES_CHAT_COMPLETIONS_URL);
  }
  return parseProviderOverrideUrl(raw, "CHUTES_CHAT_COMPLETIONS_URL");
}

export function isNonDefaultProviderOrigin(resolved: URL, defaultUrlString: string): boolean {
  return providerEndpointOrigin(resolved) !== defaultOriginFor(defaultUrlString);
}

function httpsRequiredForOrigin(origin: URL): boolean {
  if (origin.protocol === "https:") return false;
  return !isLoopbackProviderHost(origin.hostname);
}

function validateScopedOverride(
  env: NodeJS.ProcessEnv,
  field: ProviderOverrideField,
  defaultUrlString: string,
  resolve: (env: NodeJS.ProcessEnv) => URL,
): string | undefined {
  const raw = trimOverride(env[field]);
  if (raw !== undefined) {
    parseProviderOverrideUrl(raw, field);
  }
  const resolved = resolve(env);
  if (!isNonDefaultProviderOrigin(resolved, defaultUrlString)) {
    return undefined;
  }
  if (httpsRequiredForOrigin(resolved)) {
    return `${field} must use https unless the hostname is localhost or 127.0.0.1`;
  }
  return undefined;
}

export function validateProviderOverrides(
  env: NodeJS.ProcessEnv,
  input: { offline: boolean; replay: boolean },
): { ok: true } | { ok: false; message: string } {
  if (input.offline) {
    return { ok: true };
  }
  if (!input.replay) {
    const desearchError = validateScopedOverride(
      env,
      "DESEARCH_API_BASE",
      DEFAULT_DESEARCH_API_BASE,
      resolvedDesearchOverrideUrl,
    );
    if (desearchError !== undefined) {
      return { ok: false, message: desearchError };
    }
  }
  const chutesError = validateScopedOverride(
    env,
    "CHUTES_CHAT_COMPLETIONS_URL",
    DEFAULT_CHUTES_CHAT_COMPLETIONS_URL,
    resolvedChutesOverrideUrl,
  );
  if (chutesError !== undefined) {
    return { ok: false, message: chutesError };
  }
  return { ok: true };
}

export function providerOverrideWarningLines(
  env: NodeJS.ProcessEnv,
  input: { offline: boolean; replay: boolean },
): string[] {
  if (input.offline) {
    return [];
  }
  const lines: string[] = [];
  if (!input.replay) {
    const desearch = resolvedDesearchOverrideUrl(env);
    if (isNonDefaultProviderOrigin(desearch, DEFAULT_DESEARCH_API_BASE)) {
      lines.push(
        `Warning: DESEARCH_API_BASE is not the default; the Desearch API key will be sent to ${providerEndpointOrigin(desearch)}.`,
      );
    }
  }
  const chutes = resolvedChutesOverrideUrl(env);
  if (isNonDefaultProviderOrigin(chutes, DEFAULT_CHUTES_CHAT_COMPLETIONS_URL)) {
    lines.push(
      `Warning: CHUTES_CHAT_COMPLETIONS_URL is not the default; the Chutes API key will be sent to ${providerEndpointOrigin(chutes)}.`,
    );
  }
  return lines;
}

export function providerHostPreflightLines(
  env: NodeJS.ProcessEnv,
  input: { offline: boolean; replay: boolean },
): string[] {
  if (input.offline) {
    return [];
  }
  const lines: string[] = [];
  if (!input.replay) {
    lines.push(`Desearch host: ${providerEndpointOrigin(resolvedDesearchOverrideUrl(env))}`);
  }
  lines.push(`Chutes host: ${providerEndpointOrigin(resolvedChutesOverrideUrl(env))}`);
  return lines;
}
