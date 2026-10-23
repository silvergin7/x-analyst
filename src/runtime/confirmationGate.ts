import { createInterface } from "node:readline";

export async function confirmProceed(options: {
  yesFlag: boolean;
  isTTY: boolean;
  promptText?: string;
}): Promise<boolean> {
  if (options.yesFlag) return true;
  if (!options.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = options.promptText ?? "Proceed? [y/N] ";
  const answer = await new Promise<string>((resolve) => {
    rl.question(question, (value) => resolve(value));
  });
  rl.close();
  return answer.trim().toLowerCase() === "y";
}
