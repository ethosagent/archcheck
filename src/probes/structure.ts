/**
 * The structure probe. Runs the filesystem and AST-shape rules.
 *
 * What rule this enforces: evidence must name the SUBJECT, not the checker. A missing memory twin
 * is reported against the port that lacks one, with the path it was expected at — not against the
 * directory that was searched. A reader who gets "we looked in src/adapters and found nothing" has
 * to work out what was actually wrong; a reader who gets "BlobStore has no memory twin, expected
 * at src/adapters/memoryBlobStore.ts" can just go and write it.
 *
 * What a caller must know: every filesystem read goes through `ctx.fs`, so the whole probe runs
 * against the memory twin with no disk at all — the same discipline archcheck asks of consumers.
 */
import {
  asDeclaredFieldParams,
  declaredFieldApplies,
  findMissingDeclarations,
} from '../contracts/declared-field.js';
import { asRequiredFileParams, isRuleSelector, subjectsFor } from '../contracts/required-file.js';
import { dirGlobOf } from '../contracts/requiredDirs.js';
import type { ModuleGraph } from '../graph/types.js';
import type { RawFinding } from '../types.js';
import { repoRelative } from '../util/paths.js';
import type { Probe, RunCtx, Skip } from './types.js';

function requiredFileFindings(ctx: RunCtx): RawFinding[] {
  const rules = ctx.rules.filter(
    (rule) => rule.kind === 'required-file' && rule.severity !== 'off',
  );
  const findings: RawFinding[] = [];

  for (const rule of rules) {
    const params = asRequiredFileParams(rule);
    // A rule selector iterates the registry. A directory selector globs the files BELOW each
    // directory, because `ctx.fs.glob` lists files and a directory is found from what it holds.
    // Anything else iterates the files it matches.
    const dirGlob = dirGlobOf(params.forEach);
    const files = isRuleSelector(params.forEach)
      ? []
      : ctx.fs.glob(dirGlob === undefined ? params.forEach : `${dirGlob}/**`);
    for (const subject of subjectsFor(params, { rules: ctx.rules, files })) {
      const present = subject.expected.includes('*')
        ? ctx.fs.glob(subject.expected).length > 0
        : ctx.fs.exists(subject.expected);
      // mustNotExist keeps the subject list and flips which answer is the violation.
      if (params.mustNotExist === true ? !present : present) continue;
      findings.push({
        ruleId: rule.id,
        // The subject, not the searched directory. A rule subject has no file of its own, so the
        // manifest is where a reader has to go.
        file: isRuleSelector(params.forEach) ? ctx.configPath : subject.subject,
        evidence: {
          subject: subject.subject,
          expected: subject.expected,
          label: subject.label,
          ...(params.mustNotExist === true ? { mustNotExist: true } : {}),
        },
        identity: '',
      });
    }
  }

  return findings;
}

function declaredFieldFindings(ctx: RunCtx, graph: ModuleGraph): RawFinding[] {
  const rules = ctx.rules.filter(
    (rule) => rule.kind === 'declared-field' && rule.severity !== 'off',
  );
  if (rules.length === 0) return [];

  const changed = ctx.changed === undefined ? undefined : new Set(ctx.changed);
  const findings: RawFinding[] = [];

  for (const file of graph.files) {
    const relative = repoRelative(ctx.root, file);
    if (changed !== undefined && !changed.has(relative)) continue;

    for (const rule of rules) {
      const params = asDeclaredFieldParams(rule);
      if (!declaredFieldApplies(params, relative)) continue;
      for (const missing of findMissingDeclarations(params, graph.factsFor(file)?.syntax)) {
        findings.push({
          ruleId: rule.id,
          file: relative,
          line: missing.line,
          col: missing.col,
          evidence: {
            file: relative,
            call: missing.call,
            field: params.field,
            problem: missing.problem,
            ...(missing.found === undefined ? {} : { found: missing.found }),
          },
          identity: '',
        });
      }
    }
  }

  return findings;
}

export function createStructureProbe(): Probe {
  return {
    name: 'structure',
    handles: ['required-file', 'declared-field'],

    async run(ctx: RunCtx): Promise<RawFinding[] | Skip> {
      const findings = requiredFileFindings(ctx);

      const needsAst = ctx.rules.some(
        (rule) => rule.kind === 'declared-field' && rule.severity !== 'off',
      );
      if (!needsAst) return findings;

      const graph = ctx.graph();
      if (!graph.ok) return { skipped: true, reason: graph.error.join('; ') };
      return [...findings, ...declaredFieldFindings(ctx, graph.value)];
    },
  };
}
