import { DEFAULT_HANDLES, DEFAULT_QUESTION } from "./config.js";
import { parseAnalysisReferenceDate } from "./config/llmSettings.js";
import { parseHandleList } from "./validation/handles.js";

export interface CliOptions {
  handles: string[];
  invalidHandles: { raw: string; reason: string }[];
  question: string;
  /** UTC date for this invocation. Omitted when --as-of was not passed. */
  asOf?: string;
  /** True when the user asked to fetch a new slice. */
  fresh: boolean;
  /** Flags passed without a required value (e.g. `--handles` at end of argv). */
  flagErrors: string[];
}

function nextArgLooksLikeValue(argv: string[], index: number): boolean {
  const next = argv[index + 1];
  return next !== undefined && !next.startsWith("--");
}

/**
 * Words after --question until the next flag.
 * npm start runs the script through a shell that splits a quoted question
 * into separate argv entries, so those words are joined back together.
 */
function readQuestionText(
  argv: string[],
  start: number,
  initial?: string,
): { text: string; next: number; error?: string } {
  const words: string[] = [];
  if (initial !== undefined && initial !== "") words.push(initial);
  let i = start;
  while (i < argv.length && !argv[i]!.startsWith("--")) {
    words.push(argv[i]!);
    i++;
  }
  if (words.length === 0 || words.every((word) => word === "")) {
    const error =
      initial === ""
        ? "--question= requires a non-empty value"
        : words.some((word) => word === "")
          ? "Empty value for --question (expected a question string)"
          : "Missing value for --question (expected a question string)";
    return { text: "", next: i, error };
  }
  return { text: words.join(" "), next: i };
}

/** Minimal flag parser: --handles a,b --question "..." */
export function parseCliArgs(argv: string[]): CliOptions {
  let handlesRaw: string | undefined;
  let question: string | undefined;
  let asOf: string | undefined;
  let fresh = false;
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
      const read = readQuestionText(argv, i + 1);
      if (read.error) flagErrors.push(read.error);
      else question = read.text;
      i = read.next - 1;
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
      const read = readQuestionText(argv, i + 1, value);
      if (read.error) flagErrors.push(read.error);
      else question = read.text;
      i = read.next - 1;
      continue;
    }
    if (arg === "--fresh") {
      fresh = true;
      continue;
    }
    if (arg === "--as-of" || arg.startsWith("--as-of=")) {
      const value =
        arg === "--as-of"
          ? nextArgLooksLikeValue(argv, i)
            ? argv[++i]!
            : ""
          : arg.slice("--as-of=".length);
      if (value === "") {
        flagErrors.push("Missing value for --as-of (expected YYYY-MM-DD)");
      } else if (!parseAnalysisReferenceDate(value)) {
        flagErrors.push("--as-of must be a real UTC date YYYY-MM-DD");
      } else {
        asOf = value;
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
    asOf,
    fresh,
    flagErrors,
  };
}
