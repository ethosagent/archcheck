/**
 * Adoption, end to end: the baseline ratchet and exceptions through the real CLI.
 *
 * These two are what make archcheck adoptable at all. Without them a rule can never be switched on
 * anywhere that already has code, so the whole tool is greenfield-only. Both are tested through the
 * binary rather than the facade, because the exit code is the part an agent branches on.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeIdentity } from '../src/normalize/identity.js';

const ROOT = join(import.meta.dir, '..');
const CLI = join(ROOT, 'src', 'cli', 'index.ts');
const fixture = (name: string) => join(ROOT, 'fixtures', 'repos', name);

function archcheck(args: string[], cwd: string) {
  try {
    const stdout = execFileSync('bun', ['run', CLI, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as {
      status?: number;
      code?: string;
      message?: string;
      stdout?: string;
      stderr?: string;
    };
    // No numeric status means the process never started. `1` is archcheck's "new violations", so
    // mapping an EAGAIN/ENOENT spawn failure onto it forges a finding and discards the reason.
    if (typeof e.status !== 'number') {
      throw new Error(
        `could not start \`bun run ${CLI}\` in ${cwd}: ${e.code ?? ''} ${e.message ?? ''}`.trim(),
      );
    }
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function inCopyOf<T>(name: string, body: (root: string) => T): T {
  const work = mkdtempSync(join(tmpdir(), `archcheck-${name}-`));
  try {
    cpSync(fixture(name), work, { recursive: true });
    rmSync(join(work, '.archcheck'), { recursive: true, force: true });
    rmSync(join(work, 'generated'), { recursive: true, force: true });
    return body(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const violatingFile = 'modules/ledger/domain/supersede.ts';

describe('the baseline ratchet', () => {
  test('a pre-existing violation is baselined and stops failing', () => {
    inCopyOf('layered', (root) => {
      expect(archcheck([], root).code).toBe(1);

      const written = archcheck(['baseline', '--write'], root);
      expect(written.code).toBe(0);
      expect(written.stdout).toContain('recorded 2 entries in .archcheck/baseline.json');
      // Debt, stated as debt.
      expect(written.stdout).toContain('debt, not policy');

      expect(archcheck([], root).code).toBe(0);
    });
  });

  test('the file records the rule id and the date, for auditing', () => {
    inCopyOf('layered', (root) => {
      archcheck(['baseline', '--write'], root);
      const baseline = JSON.parse(readFileSync(join(root, '.archcheck', 'baseline.json'), 'utf8'));
      expect(baseline.version).toBe(1);
      expect(baseline.entries).toHaveLength(2);
      for (const entry of baseline.entries) {
        expect(entry.ruleId).toBe('domain-no-service-import');
        expect(entry.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(entry.identity).toHaveLength(16);
      }
    });
  });

  test('moving the offending code 30 lines does not change its identity', () => {
    inCopyOf('layered', (root) => {
      archcheck(['baseline', '--write'], root);
      const path = join(root, violatingFile);
      writeFileSync(path, `${'\n'.repeat(30)}${readFileSync(path, 'utf8')}`);

      // Still green, and specifically NOT exit 4 — a move must not read as "no longer reproduces".
      expect(archcheck([], root).code).toBe(0);
    });
  });

  test('a NEW violation of a baselined rule still fails', () => {
    inCopyOf('layered', (root) => {
      archcheck(['baseline', '--write'], root);
      const path = join(root, violatingFile);
      writeFileSync(
        path,
        `${readFileSync(path, 'utf8')}
import { appendEntry } from '../repositories/ledgerStore.js';
export const alsoBad = appendEntry;
`,
      );

      const run = archcheck([], root);
      expect(run.code).toBe(1);
      expect(run.stdout).toContain('domain may not import repository');
      // Only the new one is shown; the baselined two are counted.
      expect(run.stdout).toContain('✗ 1 deterministic');
    });
  });

  test('a THIRD occurrence in a file the baseline recorded twice still fails', () => {
    inCopyOf('lint', (root) => {
      // Two empty catches in one file. Their evidence is identical BY CONSTRUCTION — the snippet
      // is the literal `catch {}` both times — so they are ONE identity and one baseline entry.
      const path = join(root, 'src', 'rules', 'swallow.ts');
      const swallow = (n: number) =>
        `export function swallow${n}(): void {\n  try {\n    JSON.parse('{}');\n  } catch {}\n}\n`;
      writeFileSync(path, `${swallow(1)}${swallow(2)}`);

      expect(archcheck(['baseline', '--write'], root).code).toBe(0);
      expect(archcheck([], root).code).toBe(0);

      // A third one. Same identity, so the entry covers it — unless the count is part of the
      // ratchet, which is the bug: one entry would suppress every future occurrence in the file.
      writeFileSync(path, `${swallow(1)}${swallow(2)}${swallow(3)}`);
      const run = archcheck([], root);
      expect(run.code).toBe(1);
      expect(run.stdout).toContain('3 occurrences');
    });
  });

  test('a prune that only reduced a count says so, rather than reporting nothing', () => {
    inCopyOf('lint', (root) => {
      // Same two-empty-catch file as above: one identity, one entry, recorded as 2 occurrences.
      const path = join(root, 'src', 'rules', 'swallow.ts');
      const swallow = (n: number) =>
        `export function swallow${n}(): void {\n  try {\n    JSON.parse('{}');\n  } catch {}\n}\n`;
      writeFileSync(path, `${swallow(1)}${swallow(2)}`);
      expect(archcheck(['baseline', '--write'], root).code).toBe(0);

      // Fix ONE of the two. The identity still reproduces, so `--prune` drops no entry at all — it
      // only ratchets the recorded count down from 2 to 1, and the outcome has to say that
      // happened (`BaselineOutcome.reduced`, src/archcheck.ts).
      writeFileSync(path, swallow(1));
      expect(archcheck([], root).code).toBe(4);

      const pruned = archcheck(['baseline', '--prune'], root);
      expect(pruned.code).toBe(0);
      expect(pruned.stdout).toContain('pruned 0 entries');
      expect(pruned.stdout).toContain('reduced 1 count');
      expect(archcheck([], root).code).toBe(0);
    });
  });

  test('a 0.2.0 baseline that double-counted member-access chains is stale, not failing', () => {
    inCopyOf('lint', (root) => {
      // 0.2.0 recorded `console.warn.call` AND its inner `console.warn`, and counted `console.log`
      // twice here (once inside `console.log.call`). 0.3.0 records one occurrence per chain, so
      // those numbers come DOWN. That is the prune path (exit 4), never a new violation (exit 1).
      const file = 'src/rules/chains.ts';
      writeFileSync(
        join(root, file),
        'export function f(): void {\n  console.log.call(null, 1);\n  console.log(2);\n  console.warn.call(null, 3);\n}\n',
      );
      expect(archcheck(['baseline', '--write'], root).code).toBe(0);

      // Rewrite the file into what 0.2.0 would have written for the same code.
      const ruleId = 'no-console-outside-an-entry-point';
      const id = (snippet: string) =>
        computeIdentity(ruleId, { file, construct: 'member-access', snippet });
      const path = join(root, '.archcheck', 'baseline.json');
      const baseline = JSON.parse(readFileSync(path, 'utf8')) as {
        version: 1;
        entries: { identity: string; ruleId: string; occurrences: number }[];
      };
      const log = baseline.entries.find((entry) => entry.identity === id('console.log'));
      expect(log?.occurrences).toBe(1);
      if (log) log.occurrences = 2;
      baseline.entries.push({
        identity: id('console.warn'),
        ruleId,
        occurrences: 1,
        addedAt: '2026-01-01',
        note: 'pre-existing at adoption',
      } as (typeof baseline.entries)[number]);
      writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);

      const stale = archcheck([], root);
      expect(stale.code).toBe(4);
      expect(stale.stdout).toContain('archcheck baseline --prune');

      const pruned = archcheck(['baseline', '--prune'], root);
      expect(pruned.code).toBe(0);
      expect(pruned.stdout).toContain('pruned 1 entry');
      expect(pruned.stdout).toContain('reduced 1 count');
      expect(archcheck([], root).code).toBe(0);
    });
  });

  test('a FIXED baselined violation exits 4 until pruned, and names the command', () => {
    inCopyOf('layered', (root) => {
      archcheck(['baseline', '--write'], root);

      // Remove the illegal import entirely.
      const path = join(root, violatingFile);
      const fixed = readFileSync(path, 'utf8')
        .replace("import { writeEntry } from '../services/write.js';\n", '')
        .replace('  await writeEntry({ ...next, supersedes: previous.id });', '  void previous;');
      writeFileSync(path, fixed);

      const stale = archcheck([], root);
      expect(stale.code).toBe(4);
      expect(stale.stdout).toContain('no longer reproduce');
      expect(stale.stdout).toContain('archcheck baseline --prune');

      const pruned = archcheck(['baseline', '--prune'], root);
      expect(pruned.code).toBe(0);
      expect(pruned.stdout).toContain('pruned 1 entry');

      expect(archcheck([], root).code).toBe(0);
    });
  });

  test('a diff-scoped run does not judge the baseline — it only looked at part of the repo', () => {
    inCopyOf('layered', (root) => {
      archcheck(['baseline', '--write'], root);
      const path = join(root, violatingFile);
      writeFileSync(
        path,
        readFileSync(path, 'utf8')
          .replace("import { writeEntry } from '../services/write.js';\n", '')
          .replace('  await writeEntry({ ...next, supersedes: previous.id });', '  void previous;'),
      );

      // Unscoped: exit 4. Scoped: exit 0, because "did not reproduce" would mean "was not checked".
      expect(archcheck([], root).code).toBe(4);
      expect(archcheck(['--changed', 'modules/ledger/services/write.ts'], root).code).toBe(0);
    });
  });

  test('a degraded run does not judge the baseline — a skipped probe did not look either', () => {
    inCopyOf('layered', (root) => {
      archcheck(['baseline', '--write'], root);
      // Without a tsconfig the graph probe cannot run, so nothing reproduces — because nothing
      // was read, not because anything was fixed.
      rmSync(join(root, 'tsconfig.json'));

      const run = archcheck([], root);
      expect(run.stdout).toContain('graph did not run');
      expect(run.code).toBe(0);
    });
  });

  test('a skipped probe suppresses staleness only for the rules it would have judged', () => {
    inCopyOf('layered', (root) => {
      // A `forbidden` rule: no probe in this version handles that kind, so every run is degraded.
      // It says nothing whatsoever about the deterministic `layers` rules, which the graph probe
      // did evaluate — so a layers entry that really was fixed must still reach exit 4.
      const config = join(root, 'architecture.config.ts');
      writeFileSync(
        config,
        readFileSync(config, 'utf8').replace(
          '  ],\n});',
          `    {
      id: 'no-cross-module-import',
      kind: 'forbidden' as const,
      statement: 'one module does not reach into another',
      severity: 'error' as const,
      confidence: 'deterministic' as const,
      params: { from: 'modules/ledger/**', to: 'modules/other/**' },
      remedy: { summary: 'go through the barrel' },
    },
  ],
});`,
        ),
      );
      archcheck(['baseline', '--write'], root);
      expect(archcheck([], root).stdout).toContain('forbidden rules did not run');

      // Remove the illegal import entirely, exactly as the exit-4 test above does.
      const path = join(root, violatingFile);
      writeFileSync(
        path,
        readFileSync(path, 'utf8')
          .replace("import { writeEntry } from '../services/write.js';\n", '')
          .replace('  await writeEntry({ ...next, supersedes: previous.id });', '  void previous;'),
      );

      const run = archcheck([], root);
      expect(run.code).toBe(4);
      expect(run.stdout).toContain('no longer reproduce');
    });
  });

  test('an entry whose KIND no probe implements is not judged either', () => {
    inCopyOf('layered', (root) => {
      // The other half of the test above. That skip record names a KIND rather than a probe
      // (`'<kind> rules'`), and an entry for such a rule can never reproduce — so judging it would
      // exit 4 for ever, with `--prune` refusing because the run is degraded.
      const config = join(root, 'architecture.config.ts');
      writeFileSync(
        config,
        readFileSync(config, 'utf8').replace(
          '  ],\n});',
          `    {
      id: 'no-cross-module-import',
      kind: 'forbidden' as const,
      statement: 'one module does not reach into another',
      severity: 'error' as const,
      confidence: 'deterministic' as const,
      params: { from: 'modules/ledger/**', to: 'modules/other/**' },
      remedy: { summary: 'go through the barrel' },
    },
  ],
});`,
        ),
      );
      archcheck(['baseline', '--write'], root);

      const path = join(root, '.archcheck', 'baseline.json');
      const baseline = JSON.parse(readFileSync(path, 'utf8'));
      baseline.entries.push({
        identity: 'f0f0f0f0f0f0f0f0',
        ruleId: 'no-cross-module-import',
        addedAt: '2026-01-01',
        occurrences: 1,
      });
      writeFileSync(path, JSON.stringify(baseline, null, 2));

      expect(archcheck([], root).code).toBe(0);
    });
  });

  test('baseline --prune refuses on a degraded run rather than erasing the record', () => {
    inCopyOf('layered', (root) => {
      archcheck(['baseline', '--write'], root);
      rmSync(join(root, 'tsconfig.json'));

      const pruned = archcheck(['baseline', '--prune'], root);
      // Exit 2: the run itself is the problem, and pruning is irreversible.
      expect(pruned.code).toBe(2);
      expect(pruned.stderr).toContain('graph did not run');
      const baseline = JSON.parse(readFileSync(join(root, '.archcheck', 'baseline.json'), 'utf8'));
      expect(baseline.entries).toHaveLength(2);
    });
  });

  test('a tier-scoped run does not judge the baseline — the excluded tier was not looked at', () => {
    inCopyOf('layered', (root) => {
      const path = join(root, 'architecture.config.ts');
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replace(
          "      id: 'domain-no-service-import',",
          "      id: 'domain-no-service-import',\n      confidence: 'proxy' as const,",
        ),
      );
      archcheck(['baseline', '--write'], root);

      // `--only deterministic` never evaluates the proxy rule, so its two baselined findings must
      // not read as fixed.
      expect(archcheck(['--only', 'deterministic'], root).code).toBe(0);
      expect(archcheck([], root).code).toBe(0);
    });
  });

  test('--show-baselined reveals what the baseline is hiding', () => {
    inCopyOf('layered', (root) => {
      archcheck(['baseline', '--write'], root);
      const hidden = archcheck([], root);
      expect(hidden.stdout).toContain('2 baselined, not shown');

      const shown = archcheck(['--show-baselined'], root);
      expect(shown.stdout).toContain(violatingFile);
    });
  });

  test('baseline --write on a clean repo writes an empty baseline, not a missing one', () => {
    inCopyOf('clean', (root) => {
      expect(archcheck(['baseline', '--write'], root).code).toBe(0);
      expect(existsSync(join(root, '.archcheck', 'baseline.json'))).toBe(true);
      expect(
        JSON.parse(readFileSync(join(root, '.archcheck', 'baseline.json'), 'utf8')).entries,
      ).toEqual([]);
    });
  });

  test('baseline with no mode exits 2 rather than guessing', () => {
    const { code, stderr } = archcheck(['baseline'], fixture('clean'));
    expect(code).toBe(2);
    expect(stderr).toContain('baseline needs a mode');
  });

  test('--write outside `baseline` exits 2', () => {
    const { code, stderr } = archcheck(['--write'], fixture('clean'));
    expect(code).toBe(2);
    expect(stderr).toContain('apply to `archcheck baseline` only');
  });
});

describe('exceptions', () => {
  function withException(root: string, body: string) {
    const path = join(root, 'architecture.config.ts');
    writeFileSync(path, readFileSync(path, 'utf8').replace('  ],\n});', `  ],\n${body}\n});`));
  }

  test('an exception suppresses its violation, and the summary says so', () => {
    inCopyOf('barrels', (root) => {
      expect(archcheck([], root).code).toBe(1);

      withException(
        root,
        `  exceptions: [
    {
      rule: 'no-deep-module-imports',
      path: 'modules/graph/**',
      owner: 'mitesh',
      expires: '2099-12-31',
      reason: 'the graph module folds into ledger next quarter',
    },
  ],`,
      );

      const run = archcheck([], root);
      expect(run.code).toBe(0);
      expect(run.stdout).toContain('1 exempted, not shown');
      expect(run.stdout).toContain('1 exception(s) active');
    });
  });

  test('an exception is reported even when it suppresses nothing', () => {
    inCopyOf('clean', (root) => {
      withException(
        root,
        `  exceptions: [
    {
      rule: 'rules-are-pure',
      path: 'src/nothing-here/**',
      owner: 'mitesh',
      expires: '2099-12-31',
      reason: 'covers a path that does not exist, so it should read as doing nothing',
    },
  ],`,
      );
      const run = archcheck([], root);
      expect(run.code).toBe(0);
      expect(run.stdout).toContain('1 exception(s) active');
      const json = JSON.parse(archcheck(['--format', 'json'], root).stdout);
      expect(json.exceptions[0].suppressed).toBe(0);
    });
  });

  test('one expiring within 30 days is called out', () => {
    inCopyOf('clean', (root) => {
      const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      withException(
        root,
        `  exceptions: [
    {
      rule: 'rules-are-pure',
      path: 'src/**',
      owner: 'mitesh',
      expires: '${soon}',
      reason: 'about to lapse, and the summary must say so before it does',
    },
  ],`,
      );
      expect(archcheck([], root).stdout).toContain('expiring within 30 days');
    });
  });

  test('an EXPIRED exception fails the run, names the owner, and exits 2', () => {
    const { code, stdout } = archcheck([], fixture('expired-exception'));
    // Exit 2, not 1: the fix is a manifest edit — extend it or delete it — not a code edit.
    expect(code).toBe(2);
    expect(stdout).toContain('exception expired 2020-01-01 for rules-are-pure (src/rules/**)');
    expect(stdout).toContain('owner mitesh');
  });

  test('and the violation it used to cover comes back', () => {
    const json = JSON.parse(archcheck(['--format', 'json'], fixture('expired-exception')).stdout);
    expect(json.diagnostics).toHaveLength(1);
    expect(json.diagnostics[0].exempted).toBe(false);
    expect(json.exceptions[0]).toMatchObject({
      expired: true,
      suppressed: 0,
      owner: 'mitesh',
      path: 'src/rules/**',
    });
  });

  test('an exception with no owner fails validation at exit 2', () => {
    inCopyOf('clean', (root) => {
      withException(
        root,
        `  exceptions: [
    {
      rule: 'rules-are-pure',
      path: 'src/**',
      expires: '2099-12-31',
      reason: 'no owner, so nobody will ever re-justify it',
    },
  ],`,
      );
      const { code, stderr } = archcheck([], root);
      expect(code).toBe(2);
      expect(stderr).toContain('owner is required');
    });
  });

  test('an exception whose expiry is not a real calendar date fails validation at exit 2', () => {
    inCopyOf('clean', (root) => {
      withException(
        root,
        `  exceptions: [
    {
      rule: 'rules-are-pure',
      path: 'src/**',
      owner: 'mitesh',
      expires: '9999-99-99',
      reason: 'a date no calendar has, which would otherwise never expire',
    },
  ],`,
      );
      const { code, stderr } = archcheck([], root);
      expect(code).toBe(2);
      expect(stderr).toContain('not a real calendar date');
    });
  });

  test('an exception for an unknown rule fails validation', () => {
    inCopyOf('clean', (root) => {
      withException(
        root,
        `  exceptions: [
    {
      rule: 'no-such-rule',
      path: 'src/**',
      owner: 'mitesh',
      expires: '2099-12-31',
      reason: 'points at nothing',
    },
  ],`,
      );
      const { code, stderr } = archcheck([], root);
      expect(code).toBe(2);
      expect(stderr).toContain('is not defined in the manifest');
    });
  });
});

describe('baseline and exceptions are different things', () => {
  test('an exempted finding is never recorded as baseline debt', () => {
    inCopyOf('barrels', (root) => {
      const path = join(root, 'architecture.config.ts');
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replace(
          '  ],\n});',
          `  ],
  exceptions: [
    {
      rule: 'no-deep-module-imports',
      path: 'modules/graph/**',
      owner: 'mitesh',
      expires: '2099-12-31',
      reason: 'policy, not debt — so baseline --write must not record it',
    },
  ],
});`,
        ),
      );
      archcheck(['baseline', '--write'], root);
      const baseline = JSON.parse(readFileSync(join(root, '.archcheck', 'baseline.json'), 'utf8'));
      expect(baseline.entries).toEqual([]);
    });
  });
});
