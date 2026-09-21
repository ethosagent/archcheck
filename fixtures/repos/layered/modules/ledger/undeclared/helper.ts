// A folder nobody declared. It must fail on its first commit rather than being silently legal —
// that is case 5 of the resolution order, and the property that makes the rule set complete.
export function formatAmount(amount: number): string {
  return amount.toFixed(2);
}
