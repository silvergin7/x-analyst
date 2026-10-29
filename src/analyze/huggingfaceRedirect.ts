export const HF_MAX_REDIRECTS = 5;

export function isAllowedHfDownloadHost(hostname: string): boolean {
  if (hostname === "huggingface.co") return true;
  if (hostname.endsWith(".huggingface.co")) return true;
  if (hostname.endsWith(".hf.co")) return true;
  return false;
}

export function validateRedirectUrl(fromUrl: URL, toUrl: URL): void {
  if (toUrl.protocol !== "https:") {
    throw new Error("Hugging Face download redirect must use https");
  }
  if (!isAllowedHfDownloadHost(toUrl.hostname)) {
    throw new Error("Hugging Face download redirect host is not allowed");
  }
  if (fromUrl.protocol !== "https:") {
    throw new Error("Hugging Face download must start on https");
  }
}
