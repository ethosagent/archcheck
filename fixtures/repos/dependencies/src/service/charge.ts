import { price } from '../domain/price.js';

export const charge = (n: number): number => price(n);
