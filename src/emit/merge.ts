/**
 * Merging fragments into one file per sink.
 *
 * What rule this enforces: deterministic output. Keys are sorted at every depth and entries are
 * sorted by rule id, so the same manifest produces the same bytes on every machine and every run.
 * Without that property `emit --check` fails at random, someone disables it, and the generated
 * files start drifting from the manifest — which is the one failure this whole pipeline exists to
 * prevent.
 */
import type { Fragment, FragmentTarget } from '../types.js';
import { commentHeader, generatedMeta } from './header.js';

/** Where each sink lands. One file per sink, always at the same path. */
export const SINK_PATHS: Record<FragmentTarget, string> = {
  graph: 'graph.config.cjs',
  lint: 'lint.overrides.json',
  boundaries: 'boundaries.json',
  test: 'required.json',
  exports: 'exports.json',
};

export type SinkFile = {
  /** Relative to the generated directory. */
  path: string;
  target: FragmentTarget;
  content: string;
  ruleIds: string[];
};

/** Sort every object key at every depth. JSON.stringify preserves insertion order. */
export function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested !== undefined) out[key] = sortDeep(nested);
  }
  return out;
}

function jsonSink(target: FragmentTarget, fragments: Fragment[], source: string): SinkFile {
  const ruleIds = [...new Set(fragments.map((f) => f.ruleId))].sort();
  const body = {
    $generated: generatedMeta(source, ruleIds),
    rules: fragments
      .map((fragment) => ({ ruleId: fragment.ruleId, ...(fragment.content as object) }))
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
  };
  return {
    path: SINK_PATHS[target],
    target,
    content: `${JSON.stringify(sortDeep(body), null, 2)}\n`,
    ruleIds,
  };
}

function graphSink(fragments: Fragment[], source: string): SinkFile {
  const ruleIds = [...new Set(fragments.map((f) => f.ruleId))].sort();
  const layers = fragments
    .map((fragment) => ({ ruleId: fragment.ruleId, ...(fragment.content as object) }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const body = JSON.stringify(sortDeep({ layers }), null, 2);
  return {
    path: SINK_PATHS.graph,
    target: 'graph',
    // CommonJS because this is the shape a module-graph tool's config expects to require().
    content: `${commentHeader(source, ruleIds)}\n\nmodule.exports = ${body};\n`,
    ruleIds,
  };
}

export function mergeBySink(fragments: readonly Fragment[], source: string): SinkFile[] {
  const byTarget = new Map<FragmentTarget, Fragment[]>();
  for (const fragment of fragments) {
    const existing = byTarget.get(fragment.target);
    if (existing) existing.push(fragment);
    else byTarget.set(fragment.target, [fragment]);
  }

  const files: SinkFile[] = [];
  for (const target of Object.keys(SINK_PATHS).sort() as FragmentTarget[]) {
    const group = byTarget.get(target);
    if (!group || group.length === 0) continue;
    files.push(target === 'graph' ? graphSink(group, source) : jsonSink(target, group, source));
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
