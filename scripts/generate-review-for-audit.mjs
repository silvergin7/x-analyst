/**
 * Regenerate ignored REVIEW_FOR_AUDIT.md from git status and /tmp audit captures.
 * Parses git status paths with /^.. (.+)$/ so README.md is never truncated to EADME.md.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();

/** Git porcelain: two status columns, whitespace, then path (see git status --short). */
export function pathFromGitStatusLine(line) {
  const trimmed = line.trimEnd();
  if (trimmed.length <= 2) return trimmed;
  return trimmed.slice(2).trimStart();
}

function embedFile(relPath, lang) {
  const full = path.join(root, relPath);
  if (!fs.existsSync(full)) return "";
  const content = fs.readFileSync(full, "utf8");
  if (content.includes("```")) {
    return "## `" + relPath + "`\n\n````" + lang + "\n" + content + "\n````\n";
  }
  return "## `" + relPath + "`\n\n```" + lang + "\n" + content + "\n```\n";
}

function langFor(file) {
  if (file.endsWith(".md")) return "markdown";
  if (file.endsWith(".example")) return "bash";
  if (file.endsWith(".json")) return "json";
  return "typescript";
}

function readTmp(name) {
  return fs.readFileSync("/tmp/" + name, "utf8").trimEnd();
}

const changed = execSync("git status --short", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .map(pathFromGitStatusLine)
  .filter((f) => !f.endsWith("/"));

const branch = fs.existsSync("/tmp/audit_branch.txt")
  ? readTmp("audit_branch.txt")
  : execSync("git branch --show-current", { encoding: "utf8" }).trim();

let md = "# REVIEW_FOR_AUDIT\n\n";
md += "Temporary artifact. **Not for commit.** Project readme: **README.md**.\n\n";
md += "**Branch:** `" + branch + "`\n\n### Changed files\n\n";
for (const f of [...changed].sort()) {
  md += "- `" + f + "`\n";
}
md += "\n---\n\n";

for (const f of changed) {
  md += embedFile(f, langFor(f));
  md += "\n";
}

if (fs.existsSync("/tmp/audit_git_status.txt")) {
  md += "---\n\n## Verification\n\n";
  md += "### `git status --short`\n\n```text\n" + readTmp("audit_git_status.txt") + "\n```\n\n";
  if (fs.existsSync("/tmp/audit_npm_test.txt")) {
    md += "### `npm test`\n\n```text\n" + readTmp("audit_npm_test.txt") + "\n```\n\n";
  }
  if (fs.existsSync("/tmp/audit_npm_typecheck.txt")) {
    md += "### `npm run typecheck`\n\n```text\n" + readTmp("audit_npm_typecheck.txt") + "\n```\n\n";
  }
  if (fs.existsSync("/tmp/audit_cov_out.txt")) {
    md += "### Coverage\n\n```bash\n" + readTmp("audit_cov_cmd.txt") + "\n```\n\n```text\n" + readTmp("audit_cov_out.txt") + "\n```\n\n";
  }
}

fs.writeFileSync(path.join(root, "REVIEW_FOR_AUDIT.md"), md, "utf8");
