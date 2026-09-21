/**
 * The gates themselves, proven. A gate nobody has seen fail is a gate nobody should trust —
 * so every check script here is run against a deliberate violation as well as a clean tree.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PLANTED = join(ROOT, 'src', '__planted-bun-api.ts');

function runGate(script: string): { code: number; out: string } {
  try {
    const out = execFileSync('bash', [join('scripts', script)], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

afterEach(() => {
  rmSync(PLANTED, { force: true });
});

describe('check-lint.sh', () => {
  test('is green on the committed tree', () => {
    expect(runGate('check-lint.sh').code).toBe(0);
  });

  test('fails on a planted Bun-only API call in src/', () => {
    writeFileSync(PLANTED, "export const read = () => Bun.file('x').text();\n");
    const { code, out } = runGate('check-lint.sh');
    expect(code).not.toBe(0);
    expect(out).toContain('Bun-only API in src/');
    expect(out).toContain('__planted-bun-api.ts');
  });

  test('fails on a planted bun: module import in src/', () => {
    writeFileSync(PLANTED, "import { file } from 'bun:sqlite';\nexport const f = file;\n");
    const { code, out } = runGate('check-lint.sh');
    expect(code).not.toBe(0);
    expect(out).toContain('Bun-only API in src/');
  });
});

describe('check-typecheck.sh', () => {
  test('is green and strict', () => {
    const { code, out } = runGate('check-typecheck.sh');
    expect(code).toBe(0);
    expect(out).toContain('strict');
  });
});
