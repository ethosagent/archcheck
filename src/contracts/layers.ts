/**
 * The `layers` kind — the dependency law.
 *
 * What rule this enforces: no module imports a module it is not declared to reach. Stated that
 * precisely on purpose: "dependency direction is one-way" is the intent, and this is the part a
 * machine can decide.
 *
 * DEFAULT DENY is a property of this kind, not a setting. Resolution order for an edge A → B:
 *
 *   1. A and B in the same layer            → allowed
 *   2. B is external                        → allowed (a separate rule governs dependencies)
 *   3. B's layer ∈ A's layer.mayImport      → allowed
 *   4. anything else                        → VIOLATION
 *   5. A matches no layer                   → VIOLATION: unlayered, a different message
 *
 * Case 5 matters more than it looks. A new folder nobody declared fails on its first commit
 * rather than being silently legal, and that is the property that makes a rule set complete
 * rather than merely non-empty.
 *
 * What a caller must know: one rule declares ONE layer, and the layer table is the set of all
 * `layers` rules. A violation is attributed to the SOURCE layer's rule, because the source is
 * what has to change.
 */

import { describeMatch, isImplementsMatch, isValidMatch, type LayerMatch } from '../graph/match.js';
import { err, ok, type Result } from '../result.js';
import type { Fragment, RawFinding, Rule } from '../types.js';
import type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

export type LayersParams = {
  name: string;
  match: LayerMatch;
  /** Layer names this layer may import, or `'*'` for the composition root. */
  mayImport: string[] | '*';
  /**
   * Exactly one `layers` rule owns the unlayered-file report. It needs an owner because a file
   * that matches nothing has, by definition, no layer rule of its own to be attributed to — and
   * a finding with no rule id has no statement, no remedy and no baseline entry.
   */
  catchesUnlayered?: boolean;
  /** Exempt `import type` edges. Off by default: a type-only edge is still a dependency. */
  ignoreTypeOnly?: boolean;
};

export type Layer = {
  ruleId: string;
  name: string;
  match: LayerMatch;
  mayImport: string[] | '*';
  ignoreTypeOnly: boolean;
};

export type LayerTable = {
  layers: readonly Layer[];
  /** The rule id that owns the unlayered report, or undefined when no layers rule is active. */
  unlayeredOwner: string | undefined;
};

export function asLayersParams(rule: Rule): LayersParams {
  return rule.params as unknown as LayersParams;
}

/** The layer table is the SET of layers rules — default deny cannot be decided from one. */
export function buildLayerTable(rules: readonly Rule[]): LayerTable {
  const active = rules.filter((rule) => rule.kind === 'layers' && rule.severity !== 'off');
  const layers = active.map((rule) => {
    const params = asLayersParams(rule);
    return {
      ruleId: rule.id,
      name: params.name,
      match: params.match,
      mayImport: params.mayImport,
      ignoreTypeOnly: params.ignoreTypeOnly === true,
    };
  });
  const owner =
    active.find((rule) => asLayersParams(rule).catchesUnlayered === true)?.id ??
    (active.length === 1 ? active[0]?.id : undefined);
  return { layers, unlayeredOwner: owner };
}

export type EdgeVerdict =
  | { allowed: true }
  | {
      allowed: false;
      ruleId: string;
      fromLayer: string;
      toLayer: string;
      mayImport: readonly string[];
    };

/**
 * The whole decision, as a pure function of layer names. No paths, no AST, no I/O — so the
 * resolution order above is testable line by line without a fixture repo.
 */
export function resolveEdge(
  table: LayerTable,
  fromLayer: Layer | undefined,
  toLayerName: string | undefined,
  edge: { external: boolean; typeOnly: boolean },
): EdgeVerdict {
  if (edge.external) return { allowed: true };
  if (fromLayer === undefined) return { allowed: true };
  if (fromLayer.ignoreTypeOnly && edge.typeOnly) return { allowed: true };
  if (toLayerName === undefined) {
    // The target is internal but declared by nobody. Its own `unlayered` finding is the report:
    // declaring the missing layer is the fix, and blaming the importer would send a reader to the
    // wrong file.
    return { allowed: true };
  }
  if (toLayerName === fromLayer.name) return { allowed: true };
  if (fromLayer.mayImport === '*') return { allowed: true };
  if (fromLayer.mayImport.includes(toLayerName)) return { allowed: true };
  void table;
  return {
    allowed: false,
    ruleId: fromLayer.ruleId,
    fromLayer: fromLayer.name,
    toLayer: toLayerName,
    mayImport: fromLayer.mayImport,
  };
}

/**
 * Derive import-path patterns for a layer, for the lint sink. A layer matched by `implements`
 * has no path form, so it contributes nothing here and the graph sink carries it alone — stated
 * rather than silently dropped.
 */
function pathPatternsFor(layer: Layer): string[] {
  if (isImplementsMatch(layer.match)) return [];
  const globs = typeof layer.match === 'string' ? [layer.match] : layer.match;
  return globs.filter((glob) => !glob.startsWith('!'));
}

function validateParams(rule: Rule, ctx: ValidateCtx): Result<void> {
  const params = rule.params as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof params.name !== 'string' || params.name.length === 0) {
    errors.push('params.name is required — a layer needs a name to be referred to');
  }
  if (!isValidMatch(params.match)) {
    errors.push(
      "params.match must be a glob, a list of globs, or { implements: 'PortName' } " +
        `(got ${JSON.stringify(params.match)})`,
    );
  }

  const mayImport = params.mayImport;
  if (mayImport !== '*' && !Array.isArray(mayImport)) {
    errors.push("params.mayImport must be a list of layer names, or '*' for the composition root");
  } else if (Array.isArray(mayImport)) {
    const known = new Set(
      ctx.rules
        .filter((other) => other.kind === 'layers')
        .map((other) => (other.params as Record<string, unknown>).name)
        .filter((name): name is string => typeof name === 'string'),
    );
    for (const name of mayImport) {
      if (typeof name !== 'string') {
        errors.push(`params.mayImport contains ${JSON.stringify(name)}, which is not a layer name`);
      } else if (!known.has(name)) {
        errors.push(
          `params.mayImport names an unknown layer '${name}' — known layers are ${[...known].sort().join(', ')}`,
        );
      } else if (name === params.name) {
        errors.push(
          `params.mayImport lists its own layer '${name}' — a layer always reaches itself`,
        );
      }
    }
  }

  const owners = ctx.rules.filter(
    (other) =>
      other.kind === 'layers' &&
      other.severity !== 'off' &&
      (other.params as Record<string, unknown>).catchesUnlayered === true,
  );
  const activeLayers = ctx.rules.filter(
    (other) => other.kind === 'layers' && other.severity !== 'off',
  );
  if (owners.length > 1) {
    errors.push(
      `params.catchesUnlayered is set on ${owners.length} rules (${owners.map((o) => o.id).join(', ')}) — ` +
        'exactly one layers rule owns the unlayered-file report',
    );
  } else if (owners.length === 0 && activeLayers.length > 1) {
    errors.push(
      'no layers rule sets params.catchesUnlayered — one must, or a folder nobody declared is ' +
        'silently legal, which is the failure default-deny exists to prevent',
    );
  }

  return errors.length > 0 ? err(errors) : ok(undefined);
}

function emitFragments(rule: Rule, ctx: EmitCtx): Fragment[] {
  const table = buildLayerTable(ctx.rules);
  const self = table.layers.find((layer) => layer.ruleId === rule.id);
  if (!self) return [];

  const fragments: Fragment[] = [
    {
      target: 'graph',
      ruleId: rule.id,
      content: {
        layer: self.name,
        match: self.match,
        mayImport: self.mayImport,
        ignoreTypeOnly: self.ignoreTypeOnly,
        catchesUnlayered: table.unlayeredOwner === rule.id,
        statement: rule.statement,
      },
    },
  ];

  const selfPatterns = pathPatternsFor(self);
  if (selfPatterns.length === 0 || self.mayImport === '*') return fragments;

  const forbidden = table.layers
    .filter((other) => other.name !== self.name && !self.mayImport.includes(other.name))
    .flatMap((other) => pathPatternsFor(other).map((glob) => ({ layer: other.name, glob })));
  if (forbidden.length === 0) return fragments;

  // The statement goes INTO the message. This is the fix for the biggest problem the review
  // found: the editor squiggle shows the architecture's own sentence, not a rule name.
  fragments.push({
    target: 'lint',
    ruleId: rule.id,
    content: {
      files: selfPatterns,
      forbid: 'import-path-matching',
      patterns: forbidden.map((entry) => entry.glob).sort(),
      forbiddenLayers: [...new Set(forbidden.map((entry) => entry.layer))].sort(),
      message: `${rule.statement} — ${rule.remedy.summary}`,
    },
  });

  return fragments;
}

function explainFinding(finding: RawFinding, rule: Rule, ctx: ExplainCtx): string {
  const evidence = finding.evidence as Record<string, unknown>;
  const fromLayer = String(evidence.fromLayer ?? '?');
  const toLayer = evidence.toLayer === undefined ? undefined : String(evidence.toLayer);
  // From the manifest, never from evidence — see ExplainCtx.
  const params = asLayersParams(rule);
  const allowed = params.mayImport === '*' ? ['anything'] : (params.mayImport ?? []);

  if (evidence.unlayered === true) {
    const declared = buildLayerTable(ctx.rules)
      .layers.map((layer) => layer.name)
      .sort()
      .join(', ');
    return [
      `${finding.file} belongs to no declared layer`,
      `  declared layers: ${declared}`,
      `  → ${rule.remedy.summary}`,
    ].join('\n');
  }

  return [
    `${fromLayer} may not import ${toLayer ?? 'that'}`,
    `  ${finding.file} → ${String(evidence.to ?? '')}`,
    `  ${fromLayer} may import: ${allowed.length > 0 ? allowed.join(', ') : 'nothing'}`,
    `  → ${rule.remedy.summary}`,
  ].join('\n');
}

/**
 * Case 5 of the resolution order needs its own words. "domain may import only contracts and rules"
 * is true but irrelevant to a file that matched no layer, and "invert the call" is the wrong fix.
 */
function refineFinding(finding: RawFinding, rule: Rule, ctx: ExplainCtx): Refinement | undefined {
  const evidence = finding.evidence as Record<string, unknown>;
  if (evidence.unlayered === true) {
    const declared = buildLayerTable(ctx.rules)
      .layers.map((layer) => layer.name)
      .sort()
      .join(', ');
    return {
      statement: `${finding.file} belongs to no declared layer`,
      remedy: {
        // Deliberately no `allowed` list here. The declared layers go in the sentence instead:
        // labelling them "allowed" would say this file may import them, which is not the problem.
        summary:
          `declare the layer this path belongs to in architecture.config.ts (declared so far: ` +
          `${declared}), or move the file into one of them`,
      },
    };
  }
  const fromLayer = evidence.fromLayer;
  const toLayer = evidence.toLayer;
  if (typeof fromLayer === 'string' && typeof toLayer === 'string') {
    const params = asLayersParams(rule);
    return {
      statement: `${fromLayer} may not import ${toLayer}`,
      remedy: {
        ...rule.remedy,
        allowed: params.mayImport === '*' ? ['anything'] : (params.mayImport ?? []),
      },
    };
  }
  return undefined;
}

export const layersContract: ContractType = {
  kind: 'layers',
  validate: validateParams,
  emit: emitFragments,
  explain: explainFinding,
  refine: refineFinding,
};

export { describeMatch };
