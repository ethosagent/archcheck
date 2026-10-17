import { checkoutTotal } from '../checkout/index.js';
import { money } from '../../shared/money.js';

export const cartTotal = (amount: number): string =>
  `${money(amount)} ${checkoutTotal(amount)}`;
