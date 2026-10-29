import { LLM_RUN_BUDGET_USD } from "../config/llmSettings.js";

export class LlmRunSpendLedger {
  private committedUsd = 0;

  get totalCommittedUsd(): number {
    return this.committedUsd;
  }

  wouldExceedRunBudget(nextWorstCaseUsd: number): boolean {
    return this.committedUsd + nextWorstCaseUsd > LLM_RUN_BUDGET_USD;
  }

  recordCommittedEstimate(worstCaseUsd: number): void {
    if (!Number.isFinite(worstCaseUsd) || worstCaseUsd < 0) {
      throw new Error("LLM run ledger received an invalid estimate");
    }
    this.committedUsd += worstCaseUsd;
  }
}
