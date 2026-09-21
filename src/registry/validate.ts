/**
 * Manifest validation. Total, and it never throws.
 *
 * What rule this enforces: a malformed manifest exits 2, never 1 (LLD §6). An agent must be able
 * to tell "the config is broken" from "the code is broken", or it will spend its turn editing the
 * wrong file. That means every problem is returned together — one pass, every field named —
 * rather than thrown one at a time.
 *
 * What a caller must know: the per-kind params check is INJECTED, not imported. The registry knows
 * that a rule has a kind; only the contract type knows what that kind's params mean. Wiring the
 * two together is the facade's job, which keeps this module testable without any kind at all.
 */
import { err, ok, type Result } from '../result.js';
import { CONTRACT_KINDS, type ContractKind, type Rule } from '../types.js';
import { globProblems } from '../util/glob.js';
import type { ArchitectureManifest } from './define.js';

/**
 * The seam: kind-specific params validation, supplied by the contracts layer. It receives the
 * whole rule set because one question genuinely needs it — "does this mayImport name a layer that
 * exists?" — and passing it here rather than closing over it keeps the registry's only entry point
 * a single call.
 */
export type ParamsValidator = (rule: Rule, rules: readonly Rule[]) => Result<void>;

const SEVERITIES = new Set(['error', 'warn', 'advisory', 'off']);
const CONFIDENCES = new Set(['deterministic', 'proxy', 'model']);
const ID_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Where each kind spells a path glob. A table rather than a per-kind branch, and it is still only
 * WHERE, never what the field means — the registry knows a rule has a kind and nothing more (see
 * this module's header). A kind absent from the table simply names no globs.
 */
const GLOB_FIELDS: Partial<Record<ContractKind, readonly string[]>> = {
  layers: ['match'],
  encapsulation: ['module'],
  naming: ['appliesTo'],
  'banned-syntax': ['appliesTo'],
  'declared-field': ['appliesTo'],
  judgement: ['appliesTo'],
  'required-file': ['forEach'],
};

/**
 * A `required-file` `forEach` may be `rule[severity=error]`, which selects RULES, not paths.
 * Recognised here by its prefix rather than by importing `isRuleSelector`
 * (`src/contracts/required-file.ts`), because `registry-knows-only-rules` in
 * `architecture.config.ts` forbids `src/registry` importing `src/contracts` — and duplicating a
 * five-character prefix is far cheaper than the alternative the layer law is protecting against.
 * Deliberately looser than the real selector regex: anything selector-SHAPED is left alone here,
 * and the kind's own validate owns the grammar.
 */
const RULE_SELECTOR_PREFIX = 'rule[';

/** A glob field is a string or a list of them; `layers.match` may instead be `{ implements }`. */
function globsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
  // `{ implements: 'Port' }` names a type, not a path. Any other shape is the kind's to complain
  // about; this pass only checks patterns that really are patterns.
  return [];
}

function checkGlobs(
  field: string,
  value: unknown,
  push: (field: string, problem: string) => void,
): void {
  for (const pattern of globsIn(value)) {
    if (pattern.startsWith(RULE_SELECTOR_PREFIX)) continue;
    for (const problem of globProblems(pattern)) {
      push(field, `pattern '${pattern}' ${problem}`);
    }
  }
}

function at(index: number, id: unknown): string {
  return typeof id === 'string' && id.length > 0 ? `rules[${index}] '${id}'` : `rules[${index}]`;
}

function validateRule(
  rule: Rule,
  index: number,
  validateParams: ParamsValidator,
  allRules: readonly Rule[],
): string[] {
  const where = at(index, rule?.id);
  const errors: string[] = [];
  const push = (field: string, problem: string) => errors.push(`${where}: ${field} ${problem}`);

  if (typeof rule?.id !== 'string' || rule.id.length === 0) {
    push('id', 'is required and must be a non-empty string');
  } else if (!ID_SHAPE.test(rule.id)) {
    push('id', `must be kebab-case (got '${rule.id}') — ids appear in baselines and annotations`);
  }

  if (!CONTRACT_KINDS.includes(rule?.kind)) {
    push('kind', `must be one of ${CONTRACT_KINDS.join(', ')} (got ${JSON.stringify(rule?.kind)})`);
  }

  if (typeof rule?.statement !== 'string' || rule.statement.trim().length === 0) {
    push('statement', 'is required — it is the sentence the editor shows');
  }

  if (!SEVERITIES.has(rule?.severity)) {
    push(
      'severity',
      `must be error | warn | advisory | off (got ${JSON.stringify(rule?.severity)})`,
    );
  }

  if (!CONFIDENCES.has(rule?.confidence)) {
    push(
      'confidence',
      `must be deterministic | proxy | model (got ${JSON.stringify(rule?.confidence)})`,
    );
  }

  if (typeof rule?.remedy?.summary !== 'string' || rule.remedy.summary.trim().length === 0) {
    push('remedy.summary', 'is required — a finding without a remedy makes the reader guess');
  }

  if (typeof rule?.params !== 'object' || rule.params === null || Array.isArray(rule.params)) {
    push('params', 'must be an object');
  }

  if (rule?.expires !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.expires)) {
      push('expires', `must be an ISO date, YYYY-MM-DD (got '${rule.expires}')`);
    }
    if (typeof rule.owner !== 'string' || rule.owner.length === 0) {
      push('owner', 'is required whenever expires is set — an unowned allowance is never reviewed');
    }
  }

  // Only ask the kind about params once the envelope is sound; otherwise the kind's complaint
  // is noise on top of a rule that is already malformed.
  if (errors.length === 0) {
    const kindResult = validateParams(rule, allRules);
    if (!kindResult.ok) for (const problem of kindResult.error) errors.push(`${where}: ${problem}`);
  }

  // Glob well-formedness, in the SHARED pass rather than in any kind's validate: a malformed
  // pattern matches nothing, and outside `layers.match` a rule that matches nothing is
  // indistinguishable from a rule that passes (AGENTS.md rule 14). Here, every present and future
  // kind gets the check without opting in. Last, so a bad pattern never hides the kind's own
  // complaints. `globProblems` (src/util/glob.ts) decides what counts as malformed.
  if (typeof rule?.params === 'object' && rule.params !== null) {
    const params = rule.params as Record<string, unknown>;
    for (const field of GLOB_FIELDS[rule.kind] ?? []) {
      checkGlobs(`params.${field}`, params[field], push);
    }
  }

  return errors;
}

export function validateManifest(
  manifest: ArchitectureManifest,
  validateParams: ParamsValidator,
): Result<ArchitectureManifest> {
  const errors: string[] = [];

  if (typeof manifest !== 'object' || manifest === null) {
    return err(['the manifest must export a defineArchitecture({ ... }) object as its default']);
  }
  if (!Array.isArray(manifest.rules)) {
    return err(['manifest.rules must be an array — it is the only place a rule is defined']);
  }

  const seen = new Map<string, number>();
  for (const [index, rule] of manifest.rules.entries()) {
    errors.push(...validateRule(rule, index, validateParams, manifest.rules));
    const id = rule?.id;
    if (typeof id === 'string') {
      const first = seen.get(id);
      if (first !== undefined) {
        errors.push(`rules[${index}] '${id}': duplicate id — already defined at rules[${first}]`);
      } else {
        seen.set(id, index);
      }
    }
  }

  for (const [index, rule] of manifest.rules.entries()) {
    if (rule?.replaces !== undefined && seen.has(rule.replaces)) {
      errors.push(
        `rules[${index}] '${rule.id}': replaces '${rule.replaces}', which still exists — ` +
          'a replaced id must be gone, or nothing was replaced',
      );
    }
  }

  // An exception's `path` is a glob like any other, and an exception that matches nothing suppresses
  // nothing while still reading as a granted allowance. The rest of the exception's shape belongs to
  // `validateExceptions` (src/exceptions/index.ts); only the pattern is checked here, so the glob
  // check stays in one place for every field of the manifest.
  const exceptions = Array.isArray(manifest.exceptions) ? manifest.exceptions : [];
  for (const [index, exception] of exceptions.entries()) {
    checkGlobs('path', exception?.path, (field, problem) =>
      errors.push(`exceptions[${index}]: ${field} ${problem}`),
    );
  }

  return errors.length > 0 ? err(errors) : ok(manifest);
}
