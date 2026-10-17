import { groupBy } from 'lodash/fp.js';

export const report = (rows: string[]): unknown => groupBy(rows);
