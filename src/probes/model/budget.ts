/**
 * The per-run spend ceiling, checked BEFORE each request.
 *
 * What rule this enforces: the probe refuses rather than overspending, and it reports how many
 * rules went unjudged. A budget checked after the fact is not a budget (LLD §1.7).
 */
export type Budget = { maxUsd: number; maxCalls: number };

export const DEFAULT_BUDGET: Budget = { maxUsd: 0.5, maxCalls: 60 };

export type BudgetState = {
  /** May another call be made? */
  canSpend(): boolean;
  /** Why not, for the skip reason. */
  exhaustedReason(): string | undefined;
  record(costUsd: number): void;
  readonly spentUsd: number;
  readonly calls: number;
};

export function createBudget(budget: Budget = DEFAULT_BUDGET): BudgetState {
  let spentUsd = 0;
  let calls = 0;
  return {
    canSpend: () => calls < budget.maxCalls && spentUsd < budget.maxUsd,
    exhaustedReason: () => {
      if (calls >= budget.maxCalls) return `call budget spent (${calls}/${budget.maxCalls} calls)`;
      if (spentUsd >= budget.maxUsd) {
        return `spend budget spent ($${spentUsd.toFixed(4)}/$${budget.maxUsd.toFixed(2)})`;
      }
      return undefined;
    },
    record(costUsd: number) {
      spentUsd += costUsd;
      calls += 1;
    },
    get spentUsd() {
      return spentUsd;
    },
    get calls() {
      return calls;
    },
  };
}
