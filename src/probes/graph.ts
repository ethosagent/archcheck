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
import { buildLayerTable, type Layer, resolveEdge } from '../contracts/layers.js';
import { fileMatches } from '../graph/match.js';
import type { Edge, FileFacts, ModuleGraph } from '../graph/types.js';
import type { RawFinding } from '../types.js';
import { repoRelative } from '../util/paths.js';
import type { Probe, RunCtx, Skip } from './types.js';

export const GRAPH_REPORT_PATH = '.archcheck/graph.json';

/** What CI writes once and every other gate reads. Edges without their AST nodes. */
export type GraphReport = {
  schemaVersion: 1;
  root: string;
  files: string[];
  edges: Omit<Edge, 'node'>[];
  facts: Record<string, { implementsPorts: string[]; exports: string[] }>;
};

export function toGraphReport(graph: ModuleGraph, root: string): GraphReport {
  const facts: GraphReport['facts'] = {};
  for (const file of graph.files) {
    const fileFacts = graph.factsFor(file);
    facts[repoRelative(root, file)] = {
      implementsPorts: fileFacts?.implementsPorts ?? [],
      exports: fileFacts?.exports ?? [],
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
  if (table.layers.length === 0) return [];

  const changed = ctx.changed === undefined ? undefined : new Set(ctx.changed);
  const inScope = (file: string) =>
    changed === undefined || changed.has(repoRelative(ctx.root, file));

  const findings: RawFinding[] = [];
  const layerCache = new Map<string, Layer | undefined>();
  const layerFor = (file: string): Layer | undefined => {
    if (!layerCache.has(file)) layerCache.set(file, layerOf(table.layers, file, ctx.root, graph));
    return layerCache.get(file);
  };

  for (const edge of graph.edges) {
    if (!inScope(edge.from)) continue;
    const from = layerFor(edge.from);
    const to = edge.external ? undefined : layerFor(edge.to);
    const verdict = resolveEdge(table, from, to?.name, edge);
    if (verdict.allowed) continue;
    findings.push({
      ruleId: verdict.ruleId,
      file: repoRelative(ctx.root, edge.from),
      line: edge.line,
      col: edge.col,
      evidence: {
        from: repoRelative(ctx.root, edge.from),
        to: repoRelative(ctx.root, edge.to),
        fromLayer: verdict.fromLayer,
        toLayer: verdict.toLayer,
        specifier: edge.specifier,
      },
      identity: '',
    });
  }

  // Case 5 of the resolution order: a file nobody declared. Reported once per file, against the
  // one layers rule that owns the unlayered report.
  const owner = table.unlayeredOwner;
  if (owner !== undefined) {
    for (const file of graph.files) {
      if (!inScope(file)) continue;
      if (layerFor(file) !== undefined) continue;
      const relative = repoRelative(ctx.root, file);
      findings.push({
        ruleId: owner,
        file: relative,
        evidence: { unlayered: true, file: relative },
        identity: '',
      });
    }
  }

  return findings;
}

export function createGraphProbe(): Probe {
  return {
    name: 'graph',
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
