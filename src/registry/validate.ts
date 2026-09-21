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
import { CONTRACT_KINDS, type Rule } from '../types.js';
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

  return errors.length > 0 ? err(errors) : ok(manifest);
}
