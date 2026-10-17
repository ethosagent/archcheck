import { charge } from '../payments/sdk.js';

export const pay = (n: number): number => charge(n);
