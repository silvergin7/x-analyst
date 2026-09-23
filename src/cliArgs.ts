import { DEFAULT_HANDLES, DEFAULT_QUESTION } from "./config.js";
import { parseHandleList } from "./validation/handles.js";

export interface CliOptions {
  handles: string[];
  invalidHandles: { raw: string; reason: string }[];
  question: string;
  /** Flags passed without a required value (e.g. `--handles` at end of argv). */
  flagErrors: string[];
}

function nextArgLooksLikeValue(argv: string[], index: number): boolean {
  const next = argv[index + 1];
  return next !== undefined && !next.startsWith("--");
}

/** Minimal flag parser: --handles a,b --question "..." */
export function parseCliArgs(argv: string[]): CliOptions {
  let handlesRaw: string | undefined;
  let question: string | undefined;
  let handlesFlagSeen = false;
  let questionFlagSeen = false;
  const flagErrors: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--handles") {
      handlesFlagSeen = true;
      if (!nextArgLooksLikeValue(argv, i)) {
        flagErrors.push(
          'Missing value for --handles (expected comma-separated handles)',
        );
      } else {
        const value = argv[++i]!;
        if (value === "") {
          flagErrors.push(
            "Empty value for --handles (expected comma-separated handles)",
          );
        } else {
          handlesRaw = value;
        }
      }
      continue;
    }
    if (arg === "--question") {
      questionFlagSeen = true;
      if (!nextArgLooksLikeValue(argv, i)) {
        flagErrors.push('Missing value for --question (expected a question string)');
      } else {
        const value = argv[++i]!;
        if (value === "") {
          flagErrors.push("Empty value for --question (expected a question string)");
        } else {
          question = value;
        }
      }
      continue;
    }
    if (arg.startsWith("--handles=")) {
      handlesFlagSeen = true;
      const value = arg.slice("--handles=".length);
      if (value === "") {
        flagErrors.push("--handles= requires a non-empty comma-separated value");
      } else {
        handlesRaw = value;
      }
      continue;
    }
    if (arg.startsWith("--question=")) {
      questionFlagSeen = true;
      const value = arg.slice("--question=".length);
      if (value === "") {
        flagErrors.push("--question= requires a non-empty value");
      } else {
        question = value;
      }
    }
  }

  const useDefaultHandles = !handlesFlagSeen && flagErrors.length === 0;
  const handleInput = useDefaultHandles
    ? DEFAULT_HANDLES.join(",")
    : (handlesRaw ?? "");

  const parsed = parseHandleList(handleInput);

  const useDefaultQuestion = !questionFlagSeen && flagErrors.length === 0;

  return {
    handles: parsed.valid,
    invalidHandles: parsed.invalid,
    question: useDefaultQuestion ? DEFAULT_QUESTION : (question ?? ""),
    flagErrors,
  };
}
