/**
 * The README is documentation that can be wrong, so it is tested.
 *
 * A README with a command that does not work is worse than no README: the reader runs it, it fails,
 * and they conclude the tool is broken. These tests run every command the README and the example's
 * README promise, and assert the output the documents claim.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLI = join(ROOT, 'src', 'cli', 'index.ts');
const EXAMPLE = join(ROOT, 'examples', 'minimal-service');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const EXAMPLE_README = readFileSync(join(EXAMPLE, 'README.md'), 'utf8');

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

function inExampleCopy<T>(body: (root: string) => T): T {
  const work = mkdtempSync(join(tmpdir(), 'archcheck-readme-'));
  try {
    cpSync(EXAMPLE, work, { recursive: true });
    rmSync(join(work, '.archcheck'), { recursive: true, force: true });
    rmSync(join(work, 'generated'), { recursive: true, force: true });
    return body(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('the files the README points at exist', () => {
  for (const path of [
    'LICENSE',
    'RULES.md',
    'architecture.config.ts',
    'examples/minimal-service/README.md',
  ]) {
    test(path, () => {
      expect(existsSync(join(ROOT, path))).toBe(true);
    });
  }
});

describe('every command the README lists is a real command', () => {
  /**
   * The fenced block under `## Commands`, not English prose that happens to start with the word.
   * Anchored to the heading because an unanchored fence regex pairs with the wrong ``` — the
   * README has several earlier code blocks.
   */
  const commandsBlock = /## Commands\s*\n+```\n([\s\S]*?)```/.exec(README)?.[1] ?? '';

  test('the README has a Commands block', () => {
    expect(commandsBlock).not.toBe('');
  });

  test('every subcommand it lists is one the CLI accepts', () => {
    const documented = [
      ...new Set(
        [...commandsBlock.matchAll(/^archcheck ([a-z][a-z-]*)/gm)].map((match) => match[1] ?? ''),
      ),
    ].sort();
    // `explain` takes a rule id, so it is exercised separately below.
    expect(documented).toEqual(['baseline', 'coverage', 'emit', 'explain', 'init']);
  });

  for (const flag of ['--changed', '--format', '--only', '--version', '--help']) {
    test(`${flag} is accepted`, () => {
      const args =
        flag === '--format'
          ? ['--format', 'json']
          : flag === '--only'
            ? ['--only', 'deterministic']
            : [flag];
      expect(archcheck(args, EXAMPLE).code).toBe(0);
    });
  }

  for (const format of ['terminal', 'json', 'json-pretty', 'sarif', 'verdict']) {
    test(`--format ${format} is accepted, as the README says`, () => {
      expect(archcheck(['--format', format], EXAMPLE).code).toBe(0);
    });
  }
});

describe('the outputs the README quotes', () => {
  test('the example is green: "nothing to fix"', () => {
    expect(archcheck([], EXAMPLE).stdout).toContain('nothing to fix');
  });

  test('coverage prints "8 rules total · 100% automatable"', () => {
    expect(archcheck(['coverage'], EXAMPLE).stdout).toContain('8 rules total · 100% automatable');
    expect(EXAMPLE_README).toContain('8 rules · 100% automatable');
  });

  test('explain domain-decides-alone works, and shows the remedy', () => {
    const { code, stdout } = archcheck(['explain', 'domain-decides-alone'], EXAMPLE);
    expect(code).toBe(0);
    expect(stdout).toContain('the domain reads contracts and rules');
    expect(stdout).toContain('remedy:     invert the call: the service calls the domain');
  });

  test('--help documents every exit code the README tabulates', () => {
    const { stdout } = archcheck(['--help'], EXAMPLE);
    for (const code of ['0', '1', '2', '3', '4']) expect(stdout).toContain(`  ${code}  `);
    for (const code of ['`0`', '`1`', '`2`', '`3`', '`4`']) expect(README).toContain(code);
  });
});

describe('the example README’s "make a rule fail" steps', () => {
  test('breaking the dependency law reports what the README quotes', () => {
    inExampleCopy((root) => {
      const path = join(root, 'src', 'repositories', 'entryStore.ts');
      const source = readFileSync(path, 'utf8').split('\n');
      source.splice(
        1,
        0,
        "import { decide } from '../domain/decide.js';",
        'export const unused = decide;',
      );
      writeFileSync(path, source.join('\n'));

      const { code, stdout } = archcheck([], root);
      expect(code).toBe(1);
      expect(stdout).toContain('repositories may not import domain');
      expect(stdout).toContain('src/repositories/entryStore.ts:2');
      expect(stdout).toContain('allowed: contracts');
      expect(stdout).toContain('take what you need as an argument from the service');
    });
  });

  test('an undeclared folder is reported as unlayered', () => {
    inExampleCopy((root) => {
      const dir = join(root, 'src', 'helpers');
      cpSync(join(root, 'src', 'rules'), dir, { recursive: true });
      writeFileSync(join(dir, 'thing.ts'), 'export const x = 1;\n');
      rmSync(join(dir, 'amount.ts'), { force: true });

      const { code, stdout } = archcheck([], root);
      expect(code).toBe(1);
      expect(stdout).toContain('belongs to no declared layer');
    });
  });

  test('a console call outside the entry point is reported', () => {
    inExampleCopy((root) => {
      const path = join(root, 'src', 'domain', 'decide.ts');
      writeFileSync(
        path,
        `${readFileSync(path, 'utf8')}\nexport const shout = (m: string): void => {\n  console.log(m);\n};\n`,
      );
      const { code, stdout } = archcheck([], root);
      expect(code).toBe(1);
      expect(stdout).toContain('logging goes through one seam');
    });
  });

  test('deleting a fixture is reported', () => {
    inExampleCopy((root) => {
      rmSync(join(root, 'fixtures', 'rules', 'rules-are-pure.violation.ts'));
      const { code, stdout } = archcheck([], root);
      expect(code).toBe(1);
      expect(stdout).toContain("rule 'rules-are-pure' is missing");
    });
  });
});

describe('the adoption walkthrough in both READMEs', () => {
  test('exit 1 → baseline --write → 0 → move the code → 0 → fix it → 4 → prune → 0', () => {
    inExampleCopy((root) => {
      const path = join(root, 'src', 'repositories', 'entryStore.ts');
      const clean = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        `${clean}\nimport { decide } from '../domain/decide.js';\nexport const unused = decide;\n`,
      );
      expect(archcheck([], root).code).toBe(1);

      expect(archcheck(['baseline', '--write'], root).code).toBe(0);
      expect(archcheck([], root).code).toBe(0);

      // Move the offending import down the page. The entry keys on the evidence, not the line.
      const moved = readFileSync(path, 'utf8').split('\n');
      moved.splice(1, 0, '', '', '');
      writeFileSync(path, moved.join('\n'));
      expect(archcheck([], root).code).toBe(0);

      // Fix it properly: the recorded violation no longer happens, so the ratchet complains.
      writeFileSync(path, clean);
      expect(archcheck([], root).code).toBe(4);

      expect(archcheck(['baseline', '--prune'], root).code).toBe(0);
      expect(archcheck([], root).code).toBe(0);
    });
  });
});

describe('the README’s quick start', () => {
  test('init writes a manifest, and the first run is green', () => {
    inExampleCopy((root) => {
      rmSync(join(root, 'architecture.config.ts'));
      rmSync(join(root, 'fixtures'), { recursive: true, force: true });

      expect(archcheck(['init'], root).code).toBe(0);
      // Green means exit 0. The generated bans apply everywhere and are `warn`, so the entry
      // point's own console call IS reported — and reported as non-blocking, which is the
      // distinction the README has to make rather than promising a silent first run.
      const first = archcheck([], root);
      expect(first.code).toBe(0);
      expect(first.stdout).toContain('0 blocking');
      expect(first.stdout).toContain('(warn)');
    });
  });

  test('emit writes one file per sink the manifest actually uses', () => {
    inExampleCopy((root) => {
      expect(archcheck(['emit'], root).code).toBe(0);
      // The example declares layers, banned-syntax and required-file — so it gets the graph, lint
      // and test sinks, plus rules.json. It declares no `encapsulation` rule, so there is no
      // exports map: a sink with no fragments writes no file.
      for (const file of [
        'graph.config.cjs',
        'lint.overrides.json',
        'required.json',
        'rules.json',
      ]) {
        expect({ file, exists: existsSync(join(root, 'generated', file)) }).toEqual({
          file,
          exists: true,
        });
      }
      expect(existsSync(join(root, 'generated', 'exports.json'))).toBe(false);
    });
  });

  test('emit --check exits 3 on a stale tree, as the CI snippet relies on', () => {
    inExampleCopy((root) => {
      expect(archcheck(['emit', '--check'], root).code).toBe(3);
      archcheck(['emit'], root);
      expect(archcheck(['emit', '--check'], root).code).toBe(0);
    });
  });
});

describe('the judgement tier claims', () => {
  test('with no key, the run stays green and says which rules nobody judged', () => {
    const judgement = join(ROOT, 'fixtures', 'repos', 'judgement');
    const { code, stdout } = archcheck([], judgement);
    expect(code).toBe(0);
    expect(stdout).toContain('judgement did not run');
    expect(stdout).toContain('no ANTHROPIC_API_KEY');
  });
});
