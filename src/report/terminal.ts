/**
 * The terminal reporter — for a person at a prompt.
 *
 * What rule this enforces: output is ordered by AUTHORITY, not by file. Deterministic failures
 * first, then proxies, then advisories, so a developer can stop reading after the first group and
 * still have read everything that blocks them (plan 08).
 *
 * What a caller must know: the remedy is not optional decoration. A finding that says only what
 * failed makes the reader guess; one that says what to do next closes the ticket.
 */
import type { Confidence, Diagnostic, RunResult } from '../types.js';
import { CONFIDENCE_ORDER, type ReportCtx, type Reporter, visible } from './types.js';

const MARK: Record<Confidence, string> = { deterministic: '✗', proxy: '◑', model: '○' };
const LABEL: Record<Confidence, string> = {
  deterministic: 'deterministic',
  proxy: 'proxy · the check is narrower than the rule',
  model: 'advisory',
};

type Paint = (text: string) => string;

function palette(noColor: boolean): { dim: Paint; bold: Paint; red: Paint; yellow: Paint } {
  const wrap =
    (code: string): Paint =>
    (text) =>
      noColor ? text : `\u001B[${code}m${text}\u001B[0m`;
  return { dim: wrap('2'), bold: wrap('1'), red: wrap('31'), yellow: wrap('33') };
}

function groupOf(diagnostics: Diagnostic[], confidence: Confidence): Diagnostic[] {
  return diagnostics.filter((d) => d.confidence === confidence);
}

function renderOne(diagnostic: Diagnostic, dim: Paint): string[] {
  const position = diagnostic.line === undefined ? '' : `:${diagnostic.line}`;
  // padEnd alone collides when the statement is longer than the column, so the gap is explicit.
  const statement = diagnostic.statement.padEnd(50);
  const lines = [
    `  ${statement}${statement.endsWith(' ') ? '' : '  '}${dim(diagnostic.ruleId)}`,
    `    ${diagnostic.file}${position}`,
    `    → ${diagnostic.remedy.summary}`,
  ];
  if (diagnostic.remedy.allowed && diagnostic.remedy.allowed.length > 0) {
    lines.splice(2, 0, `    ${dim(`allowed: ${diagnostic.remedy.allowed.join(', ')}`)}`);
  }
  return lines;
}

export function createTerminalReporter(): Reporter {
  return {
    name: 'terminal',
    async report(result: RunResult, ctx: ReportCtx): Promise<string> {
      const { dim, bold, red, yellow } = palette(ctx.noColor === true);
      const shown = visible(result, ctx);
      const out: string[] = [];

      for (const confidence of CONFIDENCE_ORDER) {
        const group = groupOf(shown, confidence);
        const mark = MARK[confidence];
        const heading = `${mark} ${group.length} ${LABEL[confidence]}`;
        if (group.length === 0) {
          out.push(dim(heading));
          continue;
        }
        out.push(bold(confidence === 'deterministic' ? red(heading) : heading));
        out.push('');
        for (const diagnostic of group) {
          out.push(...renderOne(diagnostic, dim));
          out.push('');
        }
      }

      const hidden = result.diagnostics.filter((d) => d.baselined).length;
      if (hidden > 0 && ctx.showBaselined !== true) {
        out.push(dim(`  ${hidden} baselined, not shown          --show-baselined to include`));
      }

      for (const skip of result.skipped) {
        out.push(yellow(`  - ${skip.probe} did not run: ${skip.reason}`));
      }

      const { total, deterministic, proxy, model } = result.coverage;
      out.push(
        dim(
          `  ${total} rules · ${deterministic} deterministic · ${proxy} proxy · ${model} advisory`,
        ),
      );

      if (shown.length === 0 && result.skipped.length === 0) {
        out.push('');
        out.push('  nothing to fix');
      }

      return `${out.join('\n')}\n`;
    },
  };
}
