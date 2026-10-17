import { charge } from '../payments/sdk.js';

export const quick = (n: number): number => charge(n);
