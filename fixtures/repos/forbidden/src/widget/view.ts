import { fetchTotal } from '../handler/api.js';

export const render = (n: number): string => String(fetchTotal(n));
