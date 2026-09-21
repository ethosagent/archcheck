/**
 * The verdict reporter — for a blocking hook.
 *
 * What this is for: a pre-commit hook or an agent's pre-write guard needs one question answered,
 * "may this proceed?", plus enough detail to fix it if not. Prose is the wrong shape for that, and
 * so is a full RunResult.
 *
 * What a caller must know: only ERROR severity blocks. A warn or an advisory finding is reported
 * and does not block, because a non-deterministic or narrower-than-the-rule check that blocks is
 * how a check suite loses trust (LLD §1.10).
 */
import type { Diagnostic, RunResult } from '../types.js';
import type { ReportCtx, Reporter } from './types.js';
import { visible } from './types.js';

export type Verdict = {
  block: boolean;
  reason: string;
  diagnostics: Diagnostic[];
};

export function verdictFor(result: RunResult, ctx: ReportCtx = {}): Verdict {
  const shown = visible(result, ctx);
  const blocking = shown.filter((d) => d.severity === 'error');
  if (blocking.length === 0) {
    const skipped = result.skipped.length;
    return {
      block: false,
      reason:
        skipped > 0
          ? `no blocking violations (${skipped} probe(s) did not run)`
          : 'no blocking violations',
      diagnostics: shown,
    };
  }
  const first = blocking[0];
  const more = blocking.length === 1 ? '' : ` (and ${blocking.length - 1} more)`;
  return {
    block: true,
    reason: `${first?.statement ?? 'a rule was broken'} — ${first?.file ?? ''}${more}`,
    diagnostics: blocking,
  };
}

export function createVerdictReporter(): Reporter {
  return {
    name: 'verdict',
    async report(result: RunResult, ctx: ReportCtx): Promise<string> {
      return `${JSON.stringify(verdictFor(result, ctx))}\n`;
    },
  };
}
