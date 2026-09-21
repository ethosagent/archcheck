/**
 * The invariants that hold BETWEEN the seams.
 *
 * Each seam has its own tests. These are the properties that no single seam can check, and that
 * therefore fail silently: a probe that claims a kind nobody implemented, a kind that is
 * implemented but that no probe ever runs, a reporter that is registered under a name the CLI
 * does not accept.
 *
 * The first of these was a real bug. The graph probe declared `handles: ['layers', 'forbidden',
 * 'encapsulation']` and evaluated only two of them. A consumer who declared a `forbidden` rule got
 * `skipped: []`, `ok: true`, "nothing to fix", and the rule counted as deterministic coverage —
 * a declared rule, never checked, reported as compliance.
 */
import { describe, expect, test } from 'bun:test';
import { contractFor, implementedKinds } from '../src/contracts/index.js';
import { createGraphProbe } from '../src/probes/graph.js';
import { createLintProbe } from '../src/probes/lint.js';
import { createModelProbe } from '../src/probes/model/index.js';
import { createStructureProbe } from '../src/probes/structure.js';
import { reporterFor, reporterNames } from '../src/report/index.js';
import { CONTRACT_KINDS } from '../src/types.js';

const PROBES = [createGraphProbe(), createLintProbe(), createStructureProbe(), createModelProbe()];

describe('every kind a probe claims is one it can actually evaluate', () => {
  test('the kinds probes handle are exactly the kinds that have a contract type', () => {
    const claimed = [...new Set(PROBES.flatMap((probe) => [...probe.handles]))].sort();
    const implemented = [...implementedKinds()].sort();
    // If these drift apart, one of two silent failures is live:
    //   claimed but not implemented → the rule validates, never runs, and reports no skip
    //   implemented but not claimed → the rule validates, emits, and no probe ever runs it
    expect(claimed).toEqual(implemented);
  });

  test('no two probes claim the same kind', () => {
    const claimed = PROBES.flatMap((probe) => [...probe.handles]);
    expect(claimed).toHaveLength(new Set(claimed).size);
  });

  test('every claimed kind is a member of the closed set of eight', () => {
    for (const probe of PROBES) {
      for (const kind of probe.handles) {
        expect({ probe: probe.name, kind, known: CONTRACT_KINDS.includes(kind) }).toEqual({
          probe: probe.name,
          kind,
          known: true,
        });
      }
    }
  });

  test('a kind with no probe is a kind with no contract type, and vice versa', () => {
    const claimed = new Set(PROBES.flatMap((probe) => [...probe.handles]));
    for (const kind of CONTRACT_KINDS) {
      expect({ kind, probe: claimed.has(kind), contract: contractFor(kind) !== undefined }).toEqual(
        {
          kind,
          probe: claimed.has(kind),
          contract: claimed.has(kind),
        },
      );
    }
  });

  test('`forbidden` is the one unimplemented kind, and it is unimplemented on both sides', () => {
    expect(contractFor('forbidden')).toBeUndefined();
    expect(PROBES.some((probe) => probe.handles.includes('forbidden'))).toBe(false);
  });
});

describe('every probe name is distinct', () => {
  test('so a skip record names one probe unambiguously', () => {
    const names = PROBES.map((probe) => probe.name);
    expect(names).toHaveLength(new Set(names).size);
  });
});

describe('every registered reporter resolves', () => {
  test('and its name matches the key it is registered under', () => {
    for (const name of reporterNames()) {
      const reporter = reporterFor(name);
      // `json-pretty` is the one alias: same reporter, different formatting.
      expect(reporter.name).toBe(name === 'json-pretty' ? 'json' : name);
    }
  });
});
