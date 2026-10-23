import { comparePostTime, type SentPost } from "./analysisInput.js";

export interface PostAlias {
  alias: string;
  post: SentPost;
}

/** Newest first. The model sees these aliases and not the post ids. */
export function postAliases(sent: readonly SentPost[]): PostAlias[] {
  const ordered = [...sent].sort((a, b) => comparePostTime(b.post, a.post));
  return ordered.map((post, index) => ({ alias: `p${index + 1}`, post }));
}
