import { decideWithdrawal } from '../domain/withdrawal.js';

// A thin controller: validates, delegates, shapes the response. Decides nothing.
export function handleWithdrawal(amount: number, balance: number): string {
  if (!Number.isFinite(amount)) throw new Error('amount must be a number');
  return decideWithdrawal(amount, balance);
}
