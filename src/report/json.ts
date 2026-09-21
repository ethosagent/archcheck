/**
 * The JSON reporter — the agent contract.
 *
 * What rule this enforces: three properties, each of which an agent depends on (plan 08).
 *   1. `schemaVersion` is always present, so a consumer knows what it is reading.
 *   2. `skipped` is always present, even when empty — an agent must be able to tell "clean" from
 *      "did not run". A missing key is the difference between "no violations" and "no check".
 *   3. Not pretty-printed by default. It is a wire format; a human who wants to read it pipes it.
 */

import type { RunResult } from '../types.js';
import { SCHEMA_VERSION } from '../version.js';
import type { ReportCtx, Reporter } from './types.js';
import { visible } from './types.js';

export type JsonReport = RunResult & { schemaVersion: typeof SCHEMA_VERSION };

export function toJsonReport(result: RunResult, ctx: ReportCtx): JsonReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: result.ok,
    diagnostics: visible(result, ctx),
    skipped: result.skipped,
    coverage: result.coverage,
    // Both are present even when empty. An agent distinguishing "clean" from "the baseline needs
    // pruning" from "an exception expired" needs all three states, and a missing key gives it one.
    baselineStale: result.baselineStale,
    exceptions: result.exceptions,
  };
}

export function createJsonReporter(options: { pretty?: boolean } = {}): Reporter {
  return {
    name: 'json',
    async report(result: RunResult, ctx: ReportCtx): Promise<string> {
      const report = toJsonReport(result, ctx);
      return `${JSON.stringify(report, null, options.pretty === true ? 2 : undefined)}\n`;
    },
  };
}
