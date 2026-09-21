export function decideWithdrawal(amount: number, balance: number): string {
  return amount > balance * 0.9 ? 'declined' : 'approved';
}
