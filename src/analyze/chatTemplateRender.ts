import { Template } from "@huggingface/jinja";
import type { ChatMessage } from "./llmPrompt.js";

export function renderChatTemplate(
  chatTemplate: string,
  messages: readonly ChatMessage[],
): string {
  const template = new Template(chatTemplate);
  return template.render({
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    add_generation_prompt: true,
  });
}
