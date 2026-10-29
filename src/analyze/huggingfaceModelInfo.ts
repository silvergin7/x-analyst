export interface HuggingFaceModelInfo {
  sha: string;
  gated: boolean;
  private: boolean;
  siblingFiles: readonly string[];
}

export interface HuggingFaceModelInfoTransport {
  fetchModelInfo(root: string): Promise<HuggingFaceModelInfo | null>;
}

export function parseHuggingFaceModelInfoBody(body: unknown): HuggingFaceModelInfo | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const sha = typeof record.sha === "string" ? record.sha.trim() : "";
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;
  if (typeof record.gated !== "boolean" || typeof record.private !== "boolean") {
    return null;
  }
  const siblings = record.siblings;
  if (!Array.isArray(siblings)) return null;
  const siblingFiles: string[] = [];
  for (const item of siblings) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const name = (item as Record<string, unknown>).rfilename;
    if (typeof name !== "string") return null;
    siblingFiles.push(name);
  }
  return {
    sha,
    gated: record.gated,
    private: record.private,
    siblingFiles,
  };
}

export function hasPublicTokenizerJson(info: HuggingFaceModelInfo): boolean {
  return info.gated === false && info.private === false && info.siblingFiles.includes("tokenizer.json");
}
