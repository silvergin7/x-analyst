import path from "node:path";

export const HF_TOKENIZER_ROOT_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;

export const HF_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function assertSafeHfRoot(root: string): void {
  if (!HF_TOKENIZER_ROOT_PATTERN.test(root) || root.includes("..")) {
    throw new Error("Hugging Face model root is not safe");
  }
}

export function assertSafeHfCommit(commit: string): void {
  if (!HF_COMMIT_PATTERN.test(commit)) {
    throw new Error("Hugging Face commit is not safe");
  }
}

export function tokenizerCacheDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.X_ANALYST_TOKENIZER_CACHE_DIR?.trim();
  return override === "" || override === undefined
    ? path.join("data", "tokenizers")
    : override;
}

export function resolveTokenizerCacheDir(
  root: string,
  commit: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  assertSafeHfRoot(root);
  assertSafeHfCommit(commit);
  const base = path.resolve(tokenizerCacheDirectory(env));
  const dir = path.resolve(base, `${root}@${commit}`);
  const relative = path.relative(base, dir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Tokenizer cache path escapes the cache root");
  }
  return dir;
}
