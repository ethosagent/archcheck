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
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
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
    expect(stdout).toContain('exception expired 2020-01-01');
    expect(stdout).toContain('owner mitesh');
  });

  test('and the violation it used to cover comes back', () => {
    const json = JSON.parse(archcheck(['--format', 'json'], fixture('expired-exception')).stdout);
    expect(json.diagnostics).toHaveLength(1);
    expect(json.diagnostics[0].exempted).toBe(false);
    expect(json.exceptions[0]).toMatchObject({ expired: true, suppressed: 0, owner: 'mitesh' });
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
