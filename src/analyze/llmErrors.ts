import type { BudgetEstimate, ProviderTokenUsage } from "../types.js";

export class LlmOutputError extends Error {
  readonly code = "invalid_output" as const;
  providerUsage: ProviderTokenUsage | null = null;
  estimate?: BudgetEstimate;

  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

export class LlmCitationError extends Error {
  readonly code = "citation" as const;
  providerUsage: ProviderTokenUsage | null = null;
  estimate?: BudgetEstimate;

  constructor(message: string) {
    super(message);
    this.name = "LlmCitationError";
  }
}
