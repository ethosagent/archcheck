import { money } from '../../shared/money.js';

export const checkoutTotal = (amount: number): string => money(amount);
