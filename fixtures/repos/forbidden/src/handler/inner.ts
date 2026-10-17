import { fetchTotal } from './api.js';

export const total = (n: number): number => fetchTotal(n);
