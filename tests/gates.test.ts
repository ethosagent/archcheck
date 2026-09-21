/**
 * The gates themselves, proven. A gate nobody has seen fail is a gate nobody should trust —
 * so every check script here is run against a deliberate violation as well as a clean tree.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PLANTED = join(ROOT, 'src', '__planted-bun-api.ts');
const MANIFEST = join(ROOT, 'package.json');
// check-publishable.sh builds dist/ and packs it, so it is the slowest gate here. bun's default
// and check-tests.sh's --timeout are both about ordinary tests, not a tsc build plus an npm pack.
const PACK_TIMEOUT_MS = 120_000;

function runGate(script: string): { code: number; out: string } {
  try {
    const out = execFileSync('bash', [join('scripts', script)], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as {
      status?: number;
      code?: string;
      message?: string;
      stdout?: string;
      stderr?: string;
    };
    // No numeric status means the gate never ran. `1` is archcheck's "new violations", so mapping
    // an EAGAIN/ENOENT spawn failure onto it forges a finding and discards the reason.
    if (typeof e.status !== 'number') {
      throw new Error(
        `could not start \`bash scripts/${script}\` in ${ROOT}: ${e.code ?? ''} ${e.message ?? ''}`.trim(),
      );
    }
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

afterEach(() => {
  rmSync(PLANTED, { force: true });
});

// Derived from package.json exactly the way check-publishable.sh derives it, so the assertion
// below cannot drift when a second bin or an exports subpath is added. Asserting the gate names
// these — rather than only that it exited 0 — is what stops a crash (mktemp, a missing npm, a
// JSON parse error) from reading as a pass, and what stops an empty derivation from printing
// "every declared entry point is packed: " and looking like compliance (AGENTS.md rule 14).
function declaredEntryPoints(): string[] {
  const pkg = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      if (value.startsWith('.')) found.add(value.replace(/^\.\//, ''));
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) walk(child);
    }
  };
  for (const field of [pkg.bin, pkg.exports, pkg.main, pkg.types]) walk(field);
  return [...found];
}

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

describe('check-publishable.sh', () => {
  test(
    'is green on the committed tree',
    () => {
      const declared = declaredEntryPoints();
      expect(declared.length).toBeGreaterThan(0);
      const { code, out } = runGate('check-publishable.sh');
      expect(code).toBe(0);
      expect(out).toContain('every declared entry point is packed');
      for (const entry of declared) expect(out).toContain(entry);
    },
    PACK_TIMEOUT_MS,
  );

  // The planted violation is a declared entry point nothing builds — the exact shape of the bug
  // this gate exists for, and the one a hardcoded path list would miss. The gate builds dist/
  // itself, so deleting dist/ would only prove the build works.
  test(
    'fails naming an entry point the tarball does not contain',
    () => {
      const original = readFileSync(MANIFEST, 'utf8');
      try {
        const manifest = JSON.parse(original);
        manifest.types = './dist/__planted-missing.d.ts';
        writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
        const { code, out } = runGate('check-publishable.sh');
        expect(code).not.toBe(0);
        expect(out).toContain('missing declared entry point');
        expect(out).toContain('dist/__planted-missing.d.ts');
      } finally {
        // In a finally, not an afterEach: a failed assertion must not leave the manifest planted.
        writeFileSync(MANIFEST, original);
      }
    },
    PACK_TIMEOUT_MS,
  );

  // Deliberately WITHOUT --ignore-scripts, which is what the gate passes. npm runs `prepare` for
  // `npm pack`, and the Linux CI runner ran it even with the flag, so anything `prepare` printed
  // to stdout landed ahead of the JSON and the gate died parsing it — red on CI, green here. This
  // asserts the property that actually holds on both: packing this repo yields parseable JSON no
  // matter what npm decides about scripts. It fails the moment a lifecycle script gets chatty.
  test(
    'packs to parseable JSON even when npm runs the lifecycle scripts',
    () => {
      const listing = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const packed = JSON.parse(listing);
      expect(Array.isArray(packed)).toBe(true);
      expect(packed[0]?.files?.length ?? 0).toBeGreaterThan(0);
    },
    PACK_TIMEOUT_MS,
  );
});
