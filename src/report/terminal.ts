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
  // Severity is stated per finding, not only per group. Groups are ordered by CONFIDENCE, so a
  // `warn` rule appears under the deterministic heading beside a blocking one — and a reader who
  // sees only the ✗ concludes the build is broken when the exit code says it is not. That
  // misreading lands squarely on the adoption path, where most rules start at `warn`.
  const blocks = diagnostic.severity === 'error';
  const tag = blocks ? '' : ` ${dim(`(${diagnostic.severity})`)}`;
  const lines = [
    `  ${statement}${statement.endsWith(' ') ? '' : '  '}${dim(diagnostic.ruleId)}${tag}`,
    `    ${diagnostic.file}${position}`,
    `    → ${diagnostic.remedy.summary}`,
  ];
  if (diagnostic.remedy.allowed && diagnostic.remedy.allowed.length > 0) {
    lines.splice(2, 0, `    ${dim(`allowed: ${diagnostic.remedy.allowed.join(', ')}`)}`);
  }
  // One identity can stand for several violations — three empty catches in one file are one hash
  // (see `Diagnostic.occurrences`). The count and the lines are stated, or a reader fixes the one
  // position printed above and wonders why the run still fails.
  const occurrences = diagnostic.occurrences ?? 1;
  if (occurrences > 1) {
    const where =
      diagnostic.occurrenceLines === undefined || diagnostic.occurrenceLines.length === 0
        ? ''
        : `: lines ${diagnostic.occurrenceLines.join(', ')}`;
    lines.splice(2, 0, `    ${dim(`${occurrences} occurrences${where}`)}`);
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
        const blockingCount = group.filter((diagnostic) => diagnostic.severity === 'error').length;
        const suffix =
          group.length === 0 || blockingCount === group.length
            ? ''
            : ` (${blockingCount} blocking)`;
        const heading = `${mark} ${group.length} ${LABEL[confidence]}${suffix}`;
        if (group.length === 0) {
          out.push(dim(heading));
          continue;
        }
        // Red only when something in the group actually blocks.
        const blocking = group.some((diagnostic) => diagnostic.severity === 'error');
        out.push(bold(blocking ? red(heading) : heading));
        out.push('');
        for (const diagnostic of group) {
          out.push(...renderOne(diagnostic, dim));
          out.push('');
        }
      }

      const baselined = result.diagnostics.filter((d) => d.baselined && !d.exempted).length;
      const exempted = result.diagnostics.filter((d) => d.exempted).length;
      if ((baselined > 0 || exempted > 0) && ctx.showBaselined !== true) {
        const parts = [
          baselined > 0 ? `${baselined} baselined` : '',
          exempted > 0 ? `${exempted} exempted` : '',
        ].filter(Boolean);
        out.push(dim(`  ${parts.join(', ')}, not shown          --show-baselined to include`));
      }

      // Always, including the exceptions suppressing nothing: a silent exception decays into a
      // permanent one (plan 15).
      if (result.exceptions.length > 0) {
        const expiringSoon = result.exceptions.filter((e) => !e.expired && e.daysLeft <= 30).length;
        const active = result.exceptions.filter((e) => !e.expired).length;
        out.push(
          dim(
            `  ${active} exception(s) active${expiringSoon > 0 ? `, ${expiringSoon} expiring within 30 days` : ''}`,
          ),
        );
        for (const expired of result.exceptions.filter((e) => e.expired)) {
          out.push(
            red(
              `  ✗ exception expired ${expired.expires} for ${expired.ruleId} — owner ${expired.owner}`,
            ),
          );
        }
      }

      // Exit 4's explanation, in the place a person is already reading.
      if (result.baselineStale.length > 0) {
        out.push(
          red(`  ✗ ${result.baselineStale.length} baselined finding(s) no longer reproduce`),
        );
        for (const entry of result.baselineStale.slice(0, 5)) {
          out.push(dim(`      ${entry.ruleId}  ${entry.identity}  recorded ${entry.addedAt}`));
        }
        out.push(dim('    → run: npx archcheck baseline --prune'));
      }

      for (const skip of result.skipped) {
        out.push(yellow(`  - ${skip.probe} did not run: ${skip.reason}`));
      }

      const { total, deterministic, proxy, model, unchecked } = result.coverage;
      out.push(
        dim(
          `  ${total} rules · ${deterministic} deterministic · ${proxy} proxy · ${model} advisory` +
            (unchecked > 0 ? ` · ${unchecked} unchecked` : ''),
        ),
      );

      if (
        shown.length === 0 &&
        result.skipped.length === 0 &&
        result.baselineStale.length === 0 &&
        !result.exceptions.some((e) => e.expired)
      ) {
        out.push('');
        out.push('  nothing to fix');
      }

      return `${out.join('\n')}\n`;
    },
  };
}
