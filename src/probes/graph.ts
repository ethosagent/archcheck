/**
 * The graph probe. Runs layer rules against the module graph and returns raw findings.
 *
 * What rule this enforces: findings carry EVIDENCE, not prose. The probe never writes a sentence —
 * the contract type's `explain()` does. That keeps one vocabulary for "what was observed" and one
 * for "what a person should read", and it is what lets two probes observe the same violation and
 * deduplicate cleanly (plan 06, plan 07).
 *
 * Diff scoping is edge-level: given a changed set, evaluate edges whose `from` is in it. An edge
 * INTO a changed file is not a new violation — the importer did not change.
 */

import { DEFAULT_DIMENSION, dimensionsOf } from '../contracts/dimensions.js';
import { asEncapsulationParams, resolveEncapsulation } from '../contracts/encapsulation.js';
import { asForbiddenParams, forbiddenApplies } from '../contracts/forbidden.js';
import { buildLayerTable, type Layer, resolveEdge } from '../contracts/layers.js';
import { fileMatches } from '../graph/match.js';
import type { SyntaxFacts } from '../graph/syntax.js';
import type { Edge, FileFacts, ModuleGraph } from '../graph/types.js';
import type { RawFinding } from '../types.js';
import { repoRelative } from '../util/paths.js';
import { edgeInScope, isTestFile } from '../util/testEdges.js';
import type { Probe, RunCtx, Skip } from './types.js';

export const GRAPH_REPORT_PATH = '.archcheck/graph.json';

/**
 * What CI writes once and every other gate reads. Edges without their AST nodes.
 *
 * `syntax` is here so an ingested run evaluates all eight kinds. Without it `banned-syntax` and
 * `declared-field` found nothing on an ingested graph and reported no skip, which reads as a clean
 * repository — the quietest failure this tool can have.
 */
export type GraphReport = {
  schemaVersion: 1;
  root: string;
  files: string[];
  edges: Omit<Edge, 'node'>[];
  facts: Record<string, { implementsPorts: string[]; exports: string[]; syntax?: SyntaxFacts }>;
};

export function toGraphReport(graph: ModuleGraph, root: string): GraphReport {
  const facts: GraphReport['facts'] = {};
  for (const file of graph.files) {
    const fileFacts = graph.factsFor(file);
    facts[repoRelative(root, file)] = {
      implementsPorts: fileFacts?.implementsPorts ?? [],
      exports: fileFacts?.exports ?? [],
      ...(fileFacts?.syntax === undefined ? {} : { syntax: fileFacts.syntax }),
    };
  }
  return {
    schemaVersion: 1,
    root,
    files: graph.files.map((file) => repoRelative(root, file)).sort(),
    edges: graph.edges
      .map(({ node: _node, ...edge }) => ({
        ...edge,
        from: repoRelative(root, edge.from),
        to: edge.external ? edge.to : repoRelative(root, edge.to),
      }))
      .sort((a, b) =>
        `${a.from}${a.line}${a.specifier}`.localeCompare(`${b.from}${b.line}${b.specifier}`),
      ),
    facts,
  };
}

/** A ModuleGraph restored from a report. Absolute paths again, so evaluation is identical. */
export function fromGraphReport(report: GraphReport, root: string): ModuleGraph {
  const absolute = (path: string) => `${root}/${path}`;
  const facts = new Map<string, FileFacts>();
  for (const [relative, entry] of Object.entries(report.facts)) {
    facts.set(absolute(relative), {
      file: absolute(relative),
      edges: [],
      implementsPorts: entry.implementsPorts,
      exports: entry.exports,
      ...(entry.syntax === undefined ? {} : { syntax: entry.syntax }),
    });
  }
  const edges: Edge[] = report.edges.map((edge) => ({
    ...edge,
    from: absolute(edge.from),
    to: edge.external ? edge.to : absolute(edge.to),
  }));
  for (const edge of edges) {
    const entry = facts.get(edge.from);
    if (entry) entry.edges.push(edge);
  }
  return {
    files: report.files.map(absolute),
    edges,
    factsFor: (file) => facts.get(file),
    walkedCount: 0,
  };
}

function layerOf(
  layers: readonly Layer[],
  file: string,
  root: string,
  graph: ModuleGraph,
): Layer | undefined {
  // First match wins, so manifest order is how a reader resolves an overlap — a narrow layer
  // declared above a broad one reads the way it behaves.
  return layers.find((layer) => fileMatches(layer.match, file, root, graph.factsFor(file)));
}

function evaluate(graph: ModuleGraph, ctx: RunCtx): RawFinding[] {
  const table = buildLayerTable(ctx.rules);
  const barrelRules = ctx.rules.filter(
    (rule) => rule.kind === 'encapsulation' && rule.severity !== 'off',
  );
  const forbiddenRules = ctx.rules.filter(
    (rule) => rule.kind === 'forbidden' && rule.severity !== 'off',
  );
  const axisLayers = dimensionsOf(ctx.rules).length;
  if (axisLayers === 0 && barrelRules.length === 0 && forbiddenRules.length === 0) {
    return [];
  }

  // The default axis keeps the code path it had. Any further axis declared by the manifest gets
  // its own table, its own cache and its own unlayered owner, and an edge must satisfy each.
  const extraAxes = dimensionsOf(ctx.rules)
    .filter((name) => name !== DEFAULT_DIMENSION)
    .map((name) => ({
      table: buildLayerTable(ctx.rules, name),
      cache: new Map<string, Layer | undefined>(),
    }));

  const changed = ctx.changed === undefined ? undefined : new Set(ctx.changed);
  const inScope = (file: string) =>
    changed === undefined || changed.has(repoRelative(ctx.root, file));

  const findings: RawFinding[] = [];
  const layerCache = new Map<string, Layer | undefined>();
  const layerFor = (file: string): Layer | undefined => {
    if (!layerCache.has(file)) layerCache.set(file, layerOf(table.layers, file, ctx.root, graph));
    return layerCache.get(file);
  };

  type Axis = (typeof extraAxes)[number];
  const axisLayerOf = (axis: Axis, file: string): Layer | undefined => {
    if (!axis.cache.has(file)) {
      axis.cache.set(file, layerOf(axis.table.layers, file, ctx.root, graph));
    }
    return axis.cache.get(file);
  };

  /**
   * The layer this file sits in on EVERY axis, which is what a `forbidden` side reads.
   *
   * A side names a dimension and a layer name, and `layer` is simply the default dimension — so a
   * rule that reads one axis and a rule that combines two go through the same lookup. Memoised per
   * file because each edge asks twice, once for each end.
   */
  const nameCache = new Map<string, Record<string, string | undefined>>();
  const layerNamesFor = (file: string): Record<string, string | undefined> => {
    const already = nameCache.get(file);
    if (already !== undefined) return already;
    const names: Record<string, string | undefined> = {
      [DEFAULT_DIMENSION]: layerFor(file)?.name,
    };
    for (const axis of extraAxes) names[axis.table.dimension] = axisLayerOf(axis, file)?.name;
    nameCache.set(file, names);
    return names;
  };

  for (const edge of graph.edges) {
    if (!inScope(edge.from)) continue;

    // The barrel ban is edge-level too, and independent of layers: a deep import is a deep
    // import whether or not the two files happen to sit in the same layer.
    if (!edge.external) {
      const fromRelative = repoRelative(ctx.root, edge.from);
      const toRelative = repoRelative(ctx.root, edge.to);
      for (const rule of barrelRules) {
        const verdict = resolveEncapsulation(asEncapsulationParams(rule), fromRelative, toRelative);
        if (verdict.allowed) continue;
        findings.push({
          ruleId: rule.id,
          file: fromRelative,
          line: edge.line,
          col: edge.col,
          evidence: {
            from: fromRelative,
            to: toRelative,
            module: verdict.module,
            deepPath: verdict.deepPath,
            specifier: edge.specifier,
          },
          identity: '',
        });
      }
    }

    const from = layerFor(edge.from);
    const to = edge.external ? undefined : layerFor(edge.to);
    const fromPath = repoRelative(ctx.root, edge.from);
    const toPath = edge.external ? edge.specifier : repoRelative(ctx.root, edge.to);
    // Computed here rather than stored on the cached edge: the globs are manifest configuration,
    // and a manifest-derived flag written into a fact cache goes stale with nothing to notice.
    const fromIsTest = isTestFile(ctx.tests, fromPath);
    // One specific banned edge, independent of the layer law: a `forbidden` rule can ban an edge
    // inside one layer, or an external package, neither of which an allow-list can express.
    for (const rule of forbiddenRules) {
      const params = asForbiddenParams(rule);
      if (!edgeInScope(params.edges ?? 'all', fromIsTest)) continue;
      const banned = forbiddenApplies(
        params,
        { path: fromPath, external: false, layers: layerNamesFor(edge.from) },
        {
          path: toPath,
          external: edge.external,
          layers: edge.external ? {} : layerNamesFor(edge.to),
        },
      );
      if (!banned) continue;
      findings.push({
        ruleId: rule.id,
        file: fromPath,
        line: edge.line,
        col: edge.col,
        evidence: { from: fromPath, to: toPath, specifier: edge.specifier, test: fromIsTest },
        identity: '',
      });
    }

    for (const axis of extraAxes) {
      const axisFrom = axisLayerOf(axis, edge.from);
      const axisTo = edge.external ? undefined : axisLayerOf(axis, edge.to);
      const axisVerdict = resolveEdge(
        axis.table,
        axisFrom,
        axisTo?.name,
        { ...edge, test: fromIsTest },
        {
          from: fromPath,
          to: toPath,
        },
      );
      if (axisVerdict.allowed) continue;
      findings.push({
        ruleId: axisVerdict.ruleId,
        file: fromPath,
        line: edge.line,
        col: edge.col,
        evidence: {
          from: fromPath,
          to: toPath,
          dimension: axis.table.dimension,
          fromLayer: axisVerdict.fromLayer,
          toLayer: axisVerdict.toLayer,
          specifier: edge.specifier,
          test: fromIsTest,
        },
        identity: '',
      });
    }

    const verdict = resolveEdge(
      table,
      from,
      to?.name,
      { ...edge, test: fromIsTest },
      {
        from: fromPath,
        to: toPath,
      },
    );
    if (verdict.allowed) continue;
    findings.push({
      ruleId: verdict.ruleId,
      file: fromPath,
      line: edge.line,
      col: edge.col,
      evidence: {
        from: fromPath,
        to: toPath,
        fromLayer: verdict.fromLayer,
        toLayer: verdict.toLayer,
        test: fromIsTest,
        ...(verdict.fromUnit === undefined
          ? {}
          : { fromUnit: verdict.fromUnit, toUnit: verdict.toUnit }),
        ...(verdict.capture === undefined
          ? {}
          : {
              capture: verdict.capture,
              fromCapture: verdict.fromCapture,
              toCapture: verdict.toCapture,
            }),
        ...(verdict.externals === undefined ? {} : { externals: verdict.externals }),
        specifier: edge.specifier,
      },
      identity: '',
    });
  }

  // Case 5 of the resolution order: a file nobody declared. Reported once per file, against the
  // one layers rule that owns the unlayered report.
  const axisReports: { table: typeof table; cache: Map<string, Layer | undefined> }[] = [
    { table, cache: layerCache },
    ...extraAxes,
  ];
  for (const axis of axisReports) {
    const owner = axis.table.unlayeredOwner;
    if (owner === undefined) continue;
    for (const file of graph.files) {
      if (!inScope(file)) continue;
      if (!axis.cache.has(file)) {
        axis.cache.set(file, layerOf(axis.table.layers, file, ctx.root, graph));
      }
      if (axis.cache.get(file) !== undefined) continue;
      const relative = repoRelative(ctx.root, file);
      findings.push({
        ruleId: owner,
        file: relative,
        evidence: {
          unlayered: true,
          file: relative,
          ...(axis.table.dimension === DEFAULT_DIMENSION
            ? {}
            : { dimension: axis.table.dimension }),
        },
        identity: '',
      });
    }
  }

  return findings;
}

export function createGraphProbe(): Probe {
  return {
    name: 'graph',
    // `forbidden` is NOT here, although the graph is where it would live. This probe evaluates
    // `layers` and `encapsulation` and nothing else, and a probe that claims a kind it ignores
    // turns a declared rule into a silent pass: the run reports no skip, says "nothing to fix",
    // and counts the rule as checked. `handles` is a promise, so it has to be true.
    handles: ['layers', 'forbidden', 'encapsulation'],

    async run(ctx: RunCtx): Promise<RawFinding[] | Skip> {
      const graph = ctx.graph();
      if (!graph.ok) return { skipped: true, reason: graph.error.join('; ') };
      return evaluate(graph.value, ctx);
    },

    ingest(report: unknown, ctx: RunCtx): RawFinding[] {
      const parsed = report as GraphReport;
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.edges)) {
        throw new Error(`${GRAPH_REPORT_PATH} is not a graph report of schemaVersion 1`);
      }
      return evaluate(fromGraphReport(parsed, ctx.root), ctx);
    },
  };
}
