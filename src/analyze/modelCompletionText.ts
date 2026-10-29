import { LlmOutputError } from "./llmErrors.js";

const QWEN_THINK_OPEN = "<" + "think>";
const QWEN_THINK_CLOSE = "<" + "/think>";

const GEMMA_THOUGHT_OPEN = "<|channel>thought";
const GEMMA_THOUGHT_CLOSE = "<channel|>";

function stripLeadingBlock(
  trimmedStart: string,
  open: string,
  close: string,
): string | null {
  if (!trimmedStart.startsWith(open)) {
    return null;
  }
  const afterOpen = trimmedStart.slice(open.length);
  const closeIndex = afterOpen.indexOf(close);
  if (closeIndex < 0) {
    throw new LlmOutputError("Model returned an unclosed thinking block");
  }
  return afterOpen.slice(closeIndex + close.length).trimStart();
}

export function stripLeadingEmptyThinkingBlock(content: string): string {
  const trimmedStart = content.trimStart();
  const gemma = stripLeadingBlock(trimmedStart, GEMMA_THOUGHT_OPEN, GEMMA_THOUGHT_CLOSE);
  if (gemma !== null) {
    return gemma;
  }
  const qwen = stripLeadingBlock(trimmedStart, QWEN_THINK_OPEN, QWEN_THINK_CLOSE);
  if (qwen !== null) {
    return qwen;
  }
  if (
    trimmedStart.startsWith(QWEN_THINK_OPEN) ||
    trimmedStart.startsWith(GEMMA_THOUGHT_OPEN)
  ) {
    throw new LlmOutputError("Model returned an unclosed thinking block");
  }
  return content;
}

export const EMPTY_THINKING_BLOCK = `${QWEN_THINK_OPEN}${QWEN_THINK_CLOSE}`;

export const EMPTY_THINKING_BLOCK_WITH_NEWLINES = `${QWEN_THINK_OPEN}\n\n${QWEN_THINK_CLOSE}`;

export const EMPTY_GEMMA_THINKING_BLOCK = `${GEMMA_THOUGHT_OPEN}${GEMMA_THOUGHT_CLOSE}`;
