// A thick controller: it decides a business outcome instead of delegating. No deterministic check
// can see this, which is exactly why it is a judgement rule.
export function handleWithdrawal(amount: number, balance: number): string {
  if (amount > balance * 0.9) {
    return 'declined: withdrawal would leave the account under its floor';
  }
  return 'approved';
}
