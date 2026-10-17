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
import { EXIT } from '../src/archcheck.js';
import { childEnv } from './childEnv.js';

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
      env: childEnv(),
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

/**
 * The body of one README section: from its heading to the next heading or horizontal rule.
 *
 * A claim is asserted against its own section, never against the whole document — the README says
 * `archcheck emit` in several places, and a test that cannot tell them apart passes on the wrong
 * one.
 */
function section(heading: string): string {
  const start = README.indexOf(heading);
  if (start === -1) return '';
  const body = README.slice(start + heading.length);
  const end = body.search(/\n---\n|\n## /);
  return end === -1 ? body : body.slice(0, end);
}

/** README prose wraps, so a sentence assertion must not depend on where the wrap fell. */
const unwrapped = (text: string) => text.replace(/\s+/g, ' ');

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

describe('the Install section matches the package the reader installs', () => {
  const peerRange = (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>;
    }
  ).peerDependencies.typescript;
  const install = section('## Install');

  test('it quotes the TypeScript range package.json declares', () => {
    // Read from package.json, never written twice: the README said "TypeScript 5.4 or later" while
    // the peer range said `>=5.4 <7`, so a reader who followed the README got ERESOLVE from
    // `npm install archcheck typescript@7`.
    expect(peerRange).toBeTypeOf('string');
    expect(unwrapped(install)).toContain(`\`${peerRange}\``);
  });

  test('it says why TypeScript 7 is excluded', () => {
    // The run-time half of the same exclusion is `missingCompilerApi` in src/util/compilerApi.ts,
    // pinned by src/util/compilerApi.test.ts.
    expect(unwrapped(install)).toContain('TypeScript 7');
    expect(unwrapped(install)).not.toContain('TypeScript 5.4 or later');
  });
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

describe('the exit codes the README tabulates', () => {
  const exitCodes = section('### Exit codes');
  const row = (code: number) =>
    new RegExp(`^\\| \`${code}\` \\|.*$`, 'm').exec(exitCodes)?.[0] ?? '';

  test('the table lists every code the CLI can return, and no other', () => {
    const tabulated = [...exitCodes.matchAll(/^\| `(\d)` \|/gm)].map((match) => Number(match[1]));
    expect(tabulated.sort((a, b) => a - b)).toEqual(
      [...new Set<number>(Object.values(EXIT))].sort((a, b) => a - b),
    );
  });

  test('exit 2 comes from the environment too, so the row does not blame the manifest', () => {
    // Most routes to 2 are not manifest problems. `--changed` outside a git work tree is the
    // cheapest one to run: `gitChangedFiles` (src/cli/args.ts) refuses rather than reporting an
    // empty changed set, and it names the fix.
    const outside = mkdtempSync(join(tmpdir(), 'archcheck-readme-nogit-'));
    try {
      cpSync(EXAMPLE, outside, { recursive: true });
      const { code, stderr } = archcheck(['--changed'], outside);
      expect(code).toBe(2);
      expect(stderr).toContain('the environment is wrong, not the code');
      expect(stderr).toContain('→');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }

    expect(row(2)).toContain('environment');
    expect(row(2)).not.toContain('Fix the manifest.');
  });

  test('the exit 2 paragraph keeps the contrast with exit 1, and stays true', () => {
    expect(unwrapped(exitCodes)).toContain('does not spend its turn on the wrong file');
    expect(unwrapped(exitCodes)).toContain('git cannot answer');
    expect(unwrapped(exitCodes)).not.toContain('knows the problem is the manifest');
  });

  test('exit 3 on a document nobody wrote is not fixed by emit, and the row says so', () => {
    inExampleCopy((root) => {
      const manifest = join(root, 'architecture.config.ts');
      writeFileSync(
        manifest,
        readFileSync(manifest, 'utf8').replace(
          'defineArchitecture({',
          "defineArchitecture({\n  docs: ['NOT-WRITTEN.md'],",
        ),
      );
      expect(archcheck(['emit'], root).code).toBe(0);

      // Re-emitting cannot create a document nobody wrote, so `runEmit` (src/cli/index.ts)
      // suppresses the emit hint and prints the fix that works.
      const { code, stderr } = archcheck(['emit', '--check'], root);
      expect(code).toBe(3);
      expect(stderr).toContain('create it with an archcheck fence, or drop it from the manifest');
      expect(stderr).not.toContain('npx archcheck emit');
    });

    expect(row(3)).toContain('docs');
    expect(row(3)).toContain('cannot read');
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

describe('the occurrence count the README documents', () => {
  const fromCode = section('## Use archcheck from code');

  test('it names both fields the agent contract carries', () => {
    expect(unwrapped(fromCode)).toContain('`occurrences`');
    expect(unwrapped(fromCode)).toContain('`occurrenceLines`');
  });

  test('it states the adoption consequence, so a reader does not read one entry as one violation', () => {
    expect(unwrapped(fromCode)).toContain('The baseline records the count');
    expect(unwrapped(fromCode)).toContain('still fails');
  });

  test('a json diagnostic really carries both, with the collapse the README describes', () => {
    inExampleCopy((root) => {
      // Two identical console calls in one file. Evidence holds no position, so both hash to one
      // identity (`computeIdentity`, src/normalize/identity.ts) — which is the collapse the section
      // describes, seen exactly as an agent sees it.
      const path = join(root, 'src', 'domain', 'decide.ts');
      writeFileSync(
        path,
        `${readFileSync(path, 'utf8')}\nexport const shout = (m: string): void => {\n  console.log(m);\n  console.log(m);\n};\n`,
      );
      const json = JSON.parse(archcheck(['--format', 'json'], root).stdout);
      expect(json.diagnostics).toHaveLength(1);
      expect(json.diagnostics[0].occurrences).toBe(2);
      expect(json.diagnostics[0].occurrenceLines).toHaveLength(2);
    });
  });
});

describe('the judgement tier claims', () => {
  const tier = section('## The judgement tier (optional)');
  const COUNT_WORD: Record<string, number> = { three: 3, four: 4, five: 5, six: 6 };

  test('with no key, the run stays green and says which rules nobody judged', () => {
    const judgement = join(ROOT, 'fixtures', 'repos', 'judgement');
    const { code, stdout } = archcheck([], judgement);
    expect(code).toBe(0);
    expect(stdout).toContain('judgement did not run');
    expect(stdout).toContain('no ANTHROPIC_API_KEY');
  });

  test('the property count it states is the number of properties it lists', () => {
    // A count in prose drifts the moment somebody adds a property, and this one already had.
    const stated = /Read these ([a-z]+) properties/.exec(tier)?.[1] ?? '';
    const listed = [...tier.matchAll(/^\d+\. \*\*/gm)].length;
    expect(listed).toBeGreaterThan(0);
    expect(COUNT_WORD[stated]).toBe(listed);
  });

  test('it says a failed call leaves the file unjudged, never clean', () => {
    // `createModelProbe` (src/probes/model/index.ts) counts a failing call as unjudged and returns
    // a Skip naming the cause and the count.
    expect(unwrapped(tier)).toContain('unjudged');
  });

  test('it says which answers do not count as an answer, and which one does', () => {
    // `readJudgeAnswer` (src/probes/model/anthropic.ts) makes a refusal, a non-JSON reply, a reply
    // with no `verdicts` array and an all-malformed reply non-answers, and keeps them out of the
    // cache. An empty verdict list is an answer, and it is cached.
    expect(unwrapped(tier)).toContain('no `verdicts` array');
    expect(unwrapped(tier)).toContain('`{"verdicts":[]}` is an answer');
  });

  test('it says the call budget bounds a failing endpoint', () => {
    // `budget.record` runs for every issued call, answered or not (src/probes/model/index.ts).
    expect(unwrapped(tier)).toContain('`maxCalls` requests at most');
  });
});
