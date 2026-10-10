import type { Post } from "../types.js";

/**
 * Drop later copies of a post id. Pages are parsed separately, so the same id
 * can arrive again on a later page. The first copy is kept.
 */
export function dedupePostsById(posts: readonly Post[]): {
  posts: Post[];
  duplicatesRemoved: number;
} {
  const seen = new Set<string>();
  const unique: Post[] = [];
  let duplicatesRemoved = 0;
  for (const post of posts) {
    if (seen.has(post.id)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(post.id);
    unique.push(post);
  }
  return { posts: unique, duplicatesRemoved };
}
