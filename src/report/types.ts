/**
 * The third seam: a reporter. A new audience changes nothing upstream.
 *
 * What a caller must know: a reporter RETURNS its text rather than printing it. That is what makes
 * the facade usable from an agent hook without capturing stdout, and it is why `report()` may
 * return void only for a reporter whose whole job is a side effect (writing a SARIF file).
 */
import type { Diagnostic, RunResult } from '../types.js';

export type ReportCtx = {
  /** Include findings the baseline already knows about. */
  showBaselined?: boolean;
  /** Suppress colour. Set from `NO_COLOR` or a non-TTY stdout by the CLI, never guessed here. */
  noColor?: boolean;
  root?: string;
};

export type Reporter = {
  name: string;
  report(result: RunResult, ctx: ReportCtx): Promise<string | undefined>;
};

/** Deterministic failures first, then proxies, then advisories — ordered by authority. */
export const CONFIDENCE_ORDER = ['deterministic', 'proxy', 'model'] as const;

/**
 * What a reader should see. Baselined and exempted findings are suppressed by their own mechanisms
 * and counted rather than printed — but they are counted, and the count is always shown, because a
 * suppression nobody can see is one nobody reviews.
 */
export function visible(result: RunResult, ctx: ReportCtx): Diagnostic[] {
  return result.diagnostics.filter(
    (d) => d.severity !== 'off' && (ctx.showBaselined === true || (!d.baselined && !d.exempted)),
  );
}
