/**
 * The `encapsulation` kind — the module barrel, and the deep-import ban generated from it.
 *
 * What rule this enforces: another module imports `modules/ledger`, never
 * `modules/ledger/services/write`. This is the rule most often broken by accident, and the one
 * where the generated exports map moves it from DETECTED to IMPOSSIBLE.
 *
 * Two sinks, one rule — the case that forced `emit()` to return an array (LLD §1.2):
 *   1. graph   — catches deep imports inside the repo, where module resolution does not apply
 *   2. exports — makes the deep path unresolvable for anything outside the package
 * The second costs nothing extra once the first exists, and it is the promotion from a rule people
 * break to a path that does not exist.
 *
 * What a caller must know: only edges that CROSS a module boundary are checked.
 * `modules/ledger/services/write.ts` importing `modules/ledger/domain/supersede.ts` is a normal
 * internal import, not a barrel violation.
 */
import { err, ok, type Result } from '../result.js';
import type { Fragment, RawFinding, Rule } from '../types.js';
import { matches } from '../util/glob.js';
import type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

export type EncapsulationParams = {
  /** A glob matching module ROOT directories, e.g. `modules/*`. */
  module: string;
  /** Paths relative to a module root that may be imported from outside, e.g. `index.ts`. */
  publicSurface: string | string[];
};

export function asEncapsulationParams(rule: Rule): EncapsulationParams {
  return rule.params as unknown as EncapsulationParams;
}

const asParams = asEncapsulationParams;

function surfacesOf(params: EncapsulationParams): string[] {
  return typeof params.publicSurface === 'string' ? [params.publicSurface] : params.publicSurface;
}

export function publicSurfacesOf(rule: Rule): string[] {
  return surfacesOf(asParams(rule));
}

/**
 * The module a repo-relative path belongs to, or undefined. Walks the path's ancestors and returns
 * the first that the module glob matches — so `modules/*` claims `modules/ledger` for every file
 * beneath it.
 */
export function moduleOf(moduleGlob: string, relativePath: string): string | undefined {
  const segments = relativePath.split('/');
  for (let depth = segments.length - 1; depth > 0; depth -= 1) {
    const candidate = segments.slice(0, depth).join('/');
    if (matches(moduleGlob, candidate)) return candidate;
  }
  return undefined;
}

export type EncapsulationVerdict =
  | { allowed: true }
  | { allowed: false; module: string; surfaces: string[]; deepPath: string };

/** The whole decision, pure and path-only, so every case is testable without a fixture repo. */
export function resolveEncapsulation(
  params: EncapsulationParams,
  fromRelative: string,
  toRelative: string,
): EncapsulationVerdict {
  const target = moduleOf(params.module, toRelative);
  if (target === undefined) return { allowed: true };
  if (moduleOf(params.module, fromRelative) === target) return { allowed: true };

  const inside = toRelative.slice(target.length + 1);
  const surfaces = surfacesOf(params);
  // `index.ts` in the manifest must accept `index.ts`, and a resolver that landed on the file
  // itself rather than the directory. Both are the barrel.
  if (surfaces.some((surface) => inside === surface || inside === surface.replace(/\.tsx?$/, ''))) {
    return { allowed: true };
  }
  return { allowed: false, module: target, surfaces, deepPath: inside };
}

function validateParams(rule: Rule, _ctx: ValidateCtx): Result<void> {
  const params = rule.params as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof params.module !== 'string' || params.module.length === 0) {
    errors.push("params.module is required — a glob matching module roots, e.g. 'modules/*'");
  }

  const surface = params.publicSurface;
  const list = typeof surface === 'string' ? [surface] : surface;
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    !list.every((s) => typeof s === 'string' && s.length > 0)
  ) {
    errors.push("params.publicSurface is required — a path inside a module, e.g. 'index.ts'");
  } else {
    for (const entry of list) {
      if (entry.startsWith('/') || entry.startsWith('.')) {
        errors.push(`params.publicSurface '${entry}' must be relative to the module root`);
      }
    }
  }

  return errors.length > 0 ? err(errors) : ok(undefined);
}

function emitFragments(rule: Rule, _ctx: EmitCtx): Fragment[] {
  const params = asParams(rule);
  const surfaces = surfacesOf(params);
  return [
    {
      target: 'graph',
      ruleId: rule.id,
      content: { module: params.module, publicSurface: surfaces, statement: rule.statement },
    },
    {
      // The exports map: the deep path stops resolving at all for anything outside the package.
      // We emit it; the consumer commits it into their own package.json.
      target: 'exports',
      ruleId: rule.id,
      content: {
        module: params.module,
        exports: Object.fromEntries(
          surfaces.map((surface) => [
            surface === 'index.ts' ? '.' : `./${surface.replace(/\.tsx?$/, '')}`,
            `./${surface.replace(/\.tsx?$/, '.js')}`,
          ]),
        ),
      },
    },
  ];
}

function explainFinding(finding: RawFinding, rule: Rule, _ctx: ExplainCtx): string {
  const evidence = finding.evidence as Record<string, unknown>;
  const surfaces = publicSurfacesOf(rule).join(', ');
  return [
    `${String(evidence.module)} is reached through its public surface only`,
    `  ${finding.file} → ${String(evidence.to)}`,
    `  public surface: ${surfaces}`,
    `  → ${rule.remedy.summary}`,
  ].join('\n');
}

function refineFinding(finding: RawFinding, rule: Rule): Refinement {
  const evidence = finding.evidence as Record<string, unknown>;
  return {
    statement: `${String(evidence.module)} may only be imported through ${publicSurfacesOf(rule).join(' or ')}`,
    remedy: { ...rule.remedy, allowed: publicSurfacesOf(rule) },
  };
}

export const encapsulationContract: ContractType = {
  kind: 'encapsulation',
  validate: validateParams,
  emit: emitFragments,
  explain: explainFinding,
  refine: refineFinding,
};
