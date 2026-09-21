/**
 * archcheck checking archcheck — the v0.2 checkpoint.
 *
 * If it cannot hold its own dependency law it has no business holding anyone else's (LLD §9.1), so
 * this suite asserts both halves: the self-host run is green, AND a deliberate violation planted in
 * src/ turns it red. A gate nobody has seen fail is a gate nobody should trust.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLI = join(ROOT, 'src', 'cli', 'index.ts');

function archcheck(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bun', ['run', CLI, ...args], {
      cwd: ROOT,
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
        `could not start \`bun run ${CLI}\` in ${ROOT}: ${e.code ?? ''} ${e.message ?? ''}`.trim(),
      );
    }
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// A folder no layer declares. Planting inside src/graph/ would match the graph layer and
// prove nothing — the point is a folder nobody has declared at all.
const PLANTED_DIR = join(ROOT, 'src', 'planted');
const PLANTED = join(PLANTED_DIR, 'violation.ts');
const PLANTED_SYNTAX = join(ROOT, 'src', 'graph', 'plantedSyntax.ts');

afterEach(() => {
  rmSync(PLANTED_DIR, { recursive: true, force: true });
  rmSync(PLANTED_SYNTAX, { force: true });
});

describe('the self-host run', () => {
  test('is green: archcheck passes its own rules', () => {
    const { code, stdout } = archcheck(['--no-color']);
    expect(stdout).toContain('nothing to fix');
    expect(code).toBe(0);
  });

  test('declares every layer in src/, so no folder is silently unlayered', () => {
    const { stdout } = archcheck(['--format', 'json']);
    const parsed = JSON.parse(stdout);
    expect(
      parsed.diagnostics.filter((d: { evidence: { unlayered?: boolean } }) => d.evidence.unlayered),
    ).toEqual([]);
  });

  test('covers both tiers it claims — deterministic and proxy', () => {
    const { stdout } = archcheck(['--format', 'json']);
    const { coverage } = JSON.parse(stdout);
    expect(coverage.deterministic).toBeGreaterThan(10);
    expect(coverage.proxy).toBeGreaterThan(0);
    expect(coverage.total).toBe(coverage.deterministic + coverage.proxy + coverage.model);
  });

  test('emitted output is not stale', () => {
    const { code, stdout } = archcheck(['emit', '--check']);
    expect(stdout).toContain('up to date');
    expect(code).toBe(0);
  });
});

describe('a deliberate layer violation inside src/ turns it red', () => {
  test('an undeclared folder in src/ is caught as unlayered on its first commit', () => {
    mkdirSync(PLANTED_DIR, { recursive: true });
    writeFileSync(PLANTED, 'export const nothing = 1;\n');

    const { code, stdout } = archcheck(['--format', 'json']);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout);
    const unlayered = parsed.diagnostics.filter(
      (d: { evidence: { unlayered?: boolean } }) => d.evidence.unlayered === true,
    );
    expect(unlayered).toHaveLength(1);
    expect(unlayered[0].file).toBe('src/planted/violation.ts');
  });

  test('the graph layer reaching the report layer is caught', () => {
    writeFileSync(
      PLANTED_SYNTAX,
      "import { visible } from '../report/types.js';\n\nexport const leak = visible;\n",
    );

    const { code, stdout } = archcheck(['--format', 'json']);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout);
    const violation = parsed.diagnostics.find(
      (d: { ruleId: string }) => d.ruleId === 'graph-reports-facts-only',
    );
    expect(violation).toBeDefined();
    expect(violation.evidence).toMatchObject({ fromLayer: 'graph', toLayer: 'report' });
    expect(violation.statement).toBe('graph may not import report');
  });

  test('a banned construct planted in src/ is caught', () => {
    writeFileSync(
      PLANTED_SYNTAX,
      'export const t = (): number => {\n  try {\n    return 1;\n  } catch {}\n};\n',
    );

    const { code, stdout } = archcheck(['--format', 'json']);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.diagnostics.some((d: { ruleId: string }) => d.ruleId === 'no-empty-catch')).toBe(
      true,
    );
  });
});

describe('the self-host gate script', () => {
  test('check-selfhost.sh is no longer a stub, and is green', () => {
    const out = execFileSync('bash', [join('scripts', 'check-selfhost.sh')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).not.toContain('SKIP');
    expect(out).toContain('nothing to fix');
  });
});
