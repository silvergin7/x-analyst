import { assertSafeHfRoot } from "./huggingfaceTokenizerPaths.js";

export function huggingFaceModelApiUrl(root: string): string {
  assertSafeHfRoot(root);
  const parts = root.split("/");
  const owner = encodeURIComponent(parts[0]!);
  const name = encodeURIComponent(parts[1]!);
  return `https://huggingface.co/api/models/${owner}/${name}`;
}
