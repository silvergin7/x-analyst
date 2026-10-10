import { planAnalysisInput } from "./analysisInput.js";
import type {
  AnalysisInputRecord,
  AnalysisQuestion,
  EvidenceRef,
  MarketOutlook,
  PersonOutlookReport,
  Post,
  RetrievalContext,
} from "../types.js";

export interface OutlookAnalyzer {
  analyzePerson(
    handle: string,
    posts: Post[],
    question: AnalysisQuestion,
    retrieval: RetrievalContext,
  ): Promise<PersonOutlookReport>;
}

interface ScoredSignal {
  outlook: Exclude<MarketOutlook, "unclear">;
  post: Post;
  reason: string;
}

const BULLISH = /\b(constructive|bullish|room to run|revisions still trending up|improving)\b/i;
const BEARISH = /\b(recession|reducing exposure|short duration|widening)\b/i;
const CAUTIOUS = /\b(cautious|defensive|underpriced risk)\b/i;

function postsEligibleForOutlook(post: Post): { text: string; post: Post } | null {
  if (post.kind === "original") {
    return { text: post.text, post };
  }
  if (post.kind === "quote" && post.analystComment?.trim()) {
    return { text: post.analystComment, post };
  }
  return null;
}

function scorePost(post: Post): ScoredSignal | null {
  const eligible = postsEligibleForOutlook(post);
  if (!eligible) return null;

  const { text, post: p } = eligible;
  if (BULLISH.test(text)) {
    return {
      outlook: "bullish",
      post: p,
      reason: "Original post expresses constructive / bullish macro language.",
    };
  }
  if (BEARISH.test(text)) {
    return {
      outlook: "bearish",
      post: p,
      reason: "Original post emphasizes recession risk or risk reduction.",
    };
  }
  if (CAUTIOUS.test(text)) {
    return {
      outlook: "cautious",
      post: p,
      reason: "Post supports a cautious or defensive stance.",
    };
  }
  return null;
}

function dateRange(posts: Post[]): { from: string; to: string } | null {
  if (posts.length === 0) return null;
  const times = posts.map((p) => p.timestamp).sort();
  return { from: times[0]!, to: times[times.length - 1]! };
}

function toEvidence(post: Post): EvidenceRef {
  return {
    postId: post.id,
    url: post.url,
    timestamp: post.timestamp,
    kind: post.kind,
  };
}

function coverageSuffix(retrieval: RetrievalContext): string {
  if (retrieval.retrievalComplete) return "";
  const reason = retrieval.incompleteReason ?? "unknown";
  return ` Retrieval incomplete (${reason}); outlook is based on a limited slice only.`;
}

/**
 * Deterministic rule-based mock analyzer — not an LLM.
 * Replace with an LLM-backed implementation in a later step.
 */
export class MockOutlookAnalyzer implements OutlookAnalyzer {
  async analyzePerson(
    handle: string,
    posts: Post[],
    question: AnalysisQuestion,
    retrieval: RetrievalContext,
  ): Promise<PersonOutlookReport> {
    const examined = [...posts].sort(
      (a, b) => b.timestamp.localeCompare(a.timestamp),
    );
    const range = dateRange(examined);
    const inputPlan = planAnalysisInput(posts, handle);
    const analysisInput: AnalysisInputRecord[] | undefined = inputPlan.records.some(
      (record) => record.reason === "retweet_and_quote",
    )
      ? inputPlan.records
      : undefined;
    const baseMeta = {
      postsExamined: examined.length,
      retrievalComplete: retrieval.retrievalComplete,
      retrievalIncompleteReason: retrieval.incompleteReason,
      ...(analysisInput ? { analysisInput } : {}),
    };

    const signals = examined
      .map(scorePost)
      .filter((s): s is ScoredSignal => s !== null);

    if (signals.length === 0) {
      return {
        handle,
        outlook: "unclear",
        explanation:
          `Mock analysis: insufficient original commentary in the retrieved slice to infer outlook ` +
          `(question: "${question.text}"). Reposts and quotes without analyst comment are excluded.` +
          coverageSuffix(retrieval),
        dateRangeExamined: range,
        evidence: [],
        analysisSource: "mock",
        ...baseMeta,
      };
    }

    const outlookCounts = new Map<MarketOutlook, number>();
    for (const s of signals) {
      outlookCounts.set(s.outlook, (outlookCounts.get(s.outlook) ?? 0) + 1);
    }

    const dominant = [...outlookCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]![0] as Exclude<MarketOutlook, "unclear">;

    const supporting = signals.filter((s) => s.outlook === dominant);
    const evidencePosts = supporting.map((s) => s.post);
    const uniqueEvidence = [...new Map(evidencePosts.map((p) => [p.id, p])).values()];

    return {
      handle,
      outlook: dominant,
      explanation:
        `Mock analysis (not LLM): dominant signal is "${dominant}" from ` +
        `${uniqueEvidence.length} post(s) with eligible original/commentary text. ` +
        supporting[0]!.reason +
        coverageSuffix(retrieval),
      dateRangeExamined: range,
      evidence: uniqueEvidence.map(toEvidence),
      analysisSource: "mock",
      ...baseMeta,
    };
  }
}

export type EvidenceValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

/**
 * Verify each cited evidence item matches a retrieved post and belongs to the analyst.
 */
export function validateEvidenceIntegrity(
  report: PersonOutlookReport,
  posts: Post[],
): EvidenceValidationResult {
  const errors: string[] = [];
  const byId = new Map(posts.map((p) => [p.id, p]));

  for (const evidence of report.evidence) {
    const post = byId.get(evidence.postId);
    if (!post) {
      errors.push(`evidence postId ${evidence.postId} not in retrieved posts`);
      continue;
    }
    if (post.authorHandle !== report.handle) {
      errors.push(
        `evidence ${evidence.postId} author ${post.authorHandle} does not match report handle ${report.handle}`,
      );
    }
    if (post.url !== evidence.url) {
      errors.push(`evidence ${evidence.postId} url mismatch`);
    }
    if (post.timestamp !== evidence.timestamp) {
      errors.push(`evidence ${evidence.postId} timestamp mismatch`);
    }
    if (post.kind !== evidence.kind) {
      errors.push(`evidence ${evidence.postId} kind mismatch`);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
