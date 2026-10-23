import { LlmOutputError } from "./llmErrors.js";

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

function isWhitespaceOnly(text: string): boolean {
  return text.trim() === "";
}

export function stripLeadingEmptyThinkingBlock(content: string): string {
  const trimmedStart = content.trimStart();
  if (!trimmedStart.startsWith(THINK_OPEN)) {
    return content;
  }
  const afterOpen = trimmedStart.slice(THINK_OPEN.length);
  const closeIndex = afterOpen.indexOf(THINK_CLOSE);
  if (closeIndex < 0) {
    return content;
  }
  const inner = afterOpen.slice(0, closeIndex);
  if (!isWhitespaceOnly(inner)) {
    throw new LlmOutputError("Model returned non-empty thinking content");
  }
  return afterOpen.slice(closeIndex + THINK_CLOSE.length).trimStart();
}

export const EMPTY_THINKING_BLOCK = `${THINK_OPEN}${THINK_CLOSE}`;

export const EMPTY_THINKING_BLOCK_WITH_NEWLINES = `${THINK_OPEN}\n\n${THINK_CLOSE}`;
