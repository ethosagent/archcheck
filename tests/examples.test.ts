/**
 * The example in `examples/minimal-service/` is executable documentation.
 *
 * The README points a new reader at it, so it has to keep working. An example that rots is worse
 * than no example: the reader copies it, it fails, and they conclude the tool is broken.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLI = join(ROOT, 'src', 'cli', 'index.ts');
const EXAMPLE = join(ROOT, 'examples', 'minimal-service');

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

function inCopy<T>(body: (root: string) => T): T {
  const work = mkdtempSync(join(tmpdir(), 'archcheck-example-'));
  try {
    cpSync(EXAMPLE, work, { recursive: true });
    rmSync(join(work, '.archcheck'), { recursive: true, force: true });
    rmSync(join(work, 'generated'), { recursive: true, force: true });
    return body(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('the example is green as committed', () => {
  test('archcheck finds nothing to fix', () => {
    const { code, stdout } = archcheck([], EXAMPLE);
    expect(stdout).toContain('nothing to fix');
    expect(code).toBe(0);
  });

  test('every rule in it is deterministic, so a reader needs no key to run it', () => {
    const { stdout } = archcheck(['coverage'], EXAMPLE);
    expect(stdout).toContain('○ 0 judgement');
    expect(stdout).toContain('100% automatable');
  });

  test('emit writes the generated configs, and a second emit changes nothing', () => {
    inCopy((root) => {
      expect(archcheck(['emit'], root).code).toBe(0);
      expect(archcheck(['emit', '--check'], root).code).toBe(0);
      const first = readFileSync(join(root, 'generated', 'graph.config.cjs'), 'utf8');
      archcheck(['emit'], root);
      expect(readFileSync(join(root, 'generated', 'graph.config.cjs'), 'utf8')).toBe(first);
    });
  });
});

describe('each of the example’s fixtures is caught by exactly its own rule', () => {
  const DIRECTIVE = /^\/\/ archcheck-fixture:\s*(place-at|verified-by)\s+(.+)$/m;

  const { diagnostics, placed } = inCopy((root) => {
    const placedPaths = new Map<string, string>();
    for (const name of readdirSync(join(EXAMPLE, 'fixtures', 'rules')).sort()) {
      const source = readFileSync(join(EXAMPLE, 'fixtures', 'rules', name), 'utf8');
      const match = DIRECTIVE.exec(source);
      if (match?.[1] !== 'place-at') continue;
      const relative = (match[2] ?? '').trim();
      const target = join(root, relative);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
      placedPaths.set(name.replace('.violation.ts', ''), relative);
    }
    const { stdout } = archcheck(['--format', 'json'], root);
    return {
      diagnostics: JSON.parse(stdout).diagnostics as { ruleId: string; file: string }[],
      placed: placedPaths,
    };
  });

  for (const [ruleId, path] of [...placed.entries()].sort()) {
    test(`${ruleId} fires for ${path}, and nothing else does`, () => {
      const caught = [
        ...new Set(diagnostics.filter((d) => d.file === path).map((d) => d.ruleId)),
      ].sort();
      expect(caught).toEqual([ruleId]);
    });
  }
});

describe('delete a fixture, and the run fails', () => {
  test('the example demonstrates the obligation the README describes', () => {
    inCopy((root) => {
      expect(archcheck([], root).code).toBe(0);
      rmSync(join(root, 'fixtures', 'rules', 'rules-are-pure.violation.ts'));
      const { code, stdout } = archcheck([], root);
      expect(code).toBe(1);
      expect(stdout).toContain("rule 'rules-are-pure' is missing");
    });
  });
});

describe('archcheck init, on the example', () => {
  test('infers the layers, and the manifest it writes loads and is green', () => {
    inCopy((root) => {
      rmSync(join(root, 'architecture.config.ts'));
      rmSync(join(root, 'fixtures'), { recursive: true, force: true });

      const init = archcheck(['init'], root);
      expect(init.code).toBe(0);
      expect(init.stdout).toContain('inferred 6 layer(s)');
      for (const layer of ['contracts', 'domain', 'entry', 'repositories', 'rules', 'services']) {
        expect(init.stdout).toContain(layer);
      }

      // Day one is green: every generated rule is `warn`, so nobody has to fix anything to adopt.
      const run = archcheck([], root);
      expect(run.code).toBe(0);
    });
  });

  test('it refuses to overwrite an existing manifest without --force', () => {
    inCopy((root) => {
      const { code, stderr } = archcheck(['init'], root);
      expect(code).toBe(2);
      expect(stderr).toContain('already exists');
      expect(stderr).toContain('--force');
    });
  });

  test('tightening a generated rule catches a real edge', () => {
    inCopy((root) => {
      rmSync(join(root, 'architecture.config.ts'));
      rmSync(join(root, 'fixtures'), { recursive: true, force: true });
      archcheck(['init'], root);

      const config = join(root, 'architecture.config.ts');
      const source = readFileSync(config, 'utf8');
      // `init` observed what services actually imports, which is contracts and domain.
      expect(source).toContain("mayImport: ['contracts', 'domain']");
      writeFileSync(
        config,
        source.replace("mayImport: ['contracts', 'domain'],", "mayImport: ['contracts'],"),
      );

      const run = archcheck([], root);
      expect(run.stdout).toContain('services may not import domain');
      // Still `warn`, so it reports without blocking — and says so rather than only showing ✗.
      expect(run.stdout).toContain('(warn)');
      expect(run.stdout).toContain('0 blocking');
      expect(run.code).toBe(0);
    });
  });
});

describe('init never degrades silently', () => {
  test('a module graph it cannot read is reported, and exits 2', () => {
    inCopy((root) => {
      rmSync(join(root, 'architecture.config.ts'));
      rmSync(join(root, 'fixtures'), { recursive: true, force: true });
      // No tsconfig means no graph. init can still name the layers, but every mayImport list is
      // then empty — a manifest that describes nothing while looking like one that does.
      rmSync(join(root, 'tsconfig.json'));

      const { code, stdout, stderr } = archcheck(['init'], root);
      expect(code).toBe(2);
      expect(stdout).toContain('inferred 6 layer(s)');
      expect(stderr).toContain('could not read your module graph');
      expect(stderr).toContain('mayImport list is EMPTY');
      expect(stderr).toContain('--force');
    });
  });
});
