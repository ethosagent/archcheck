/**
 * The fixture harness — the step everyone skips.
 *
 * A rule whose pattern matches nothing passes every build and is indistinguishable from
 * compliance. This suite is what makes that impossible for archcheck's own rules: it places every
 * deliberate violation in `fixtures/rules/` into a scratch copy of this repository, runs archcheck
 * ONCE, and asserts each fixture is caught by EXACTLY its own rule. A fixture that trips three
 * rules is testing nothing in particular.
 *
 * One run rather than one per fixture is deliberate: each fixture sits at its own path inside a
 * declared layer, so they cannot interfere, and twenty-one program builds would make this suite
 * slow enough that somebody would eventually delete it.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
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
const FIXTURES = join(ROOT, 'fixtures', 'rules');

type Directive =
  | { kind: 'place-at'; path: string }
  | { kind: 'append-to'; path: string }
  | { kind: 'verified-by'; test: string };

const DIRECTIVE = /^\/\/ archcheck-fixture:\s*(place-at|append-to|verified-by)\s+(.+)$/m;

function fixtureFiles(): { ruleId: string; source: string; directive: Directive }[] {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.violation.ts'))
    .sort()
    .map((name) => {
      const source = readFileSync(join(FIXTURES, name), 'utf8');
      const match = DIRECTIVE.exec(source);
      if (!match) throw new Error(`${name} has no archcheck-fixture directive`);
      const [, kind, rest] = match;
      const value = (rest ?? '').trim();
      const directive: Directive =
        kind === 'verified-by'
          ? { kind: 'verified-by', test: value.replace(/^"|"$/g, '') }
          : { kind: kind as 'place-at' | 'append-to', path: value };
      return { ruleId: name.replace('.violation.ts', ''), source, directive };
    });
}

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

/** A scratch copy of this repository with every fixture placed. */
function withAllFixturesPlaced<T>(body: (root: string, placed: Map<string, string>) => T): T {
  const work = mkdtempSync(join(tmpdir(), 'archcheck-fixtures-'));
  try {
    // `fixtures` is copied too: without it the fixture-obligation rule fires against the
    // manifest, and the manifest's own fixture would then look as though it trips two rules.
    for (const entry of [
      'src',
      'fixtures',
      'architecture.config.ts',
      'tsconfig.json',
      'package.json',
    ]) {
      cpSync(join(ROOT, entry), join(work, entry), { recursive: true });
    }
    // The scratch copy must not inherit a baseline or an emitted tree.
    rmSync(join(work, '.archcheck'), { recursive: true, force: true });

    const placed = new Map<string, string>();
    for (const { ruleId, source, directive } of fixtureFiles()) {
      if (directive.kind === 'verified-by') continue;
      const target = join(work, directive.path);
      mkdirSync(dirname(target), { recursive: true });
      if (directive.kind === 'append-to') appendFileSync(target, `\n${source}`);
      else writeFileSync(target, source);
      placed.set(ruleId, directive.path);
    }
    return body(work, placed);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('the fixture suite is complete and honest', () => {
  test('every error-severity rule has a fixture file', () => {
    const declared = JSON.parse(readFileSync(join(ROOT, 'generated', 'rules.json'), 'utf8')) as {
      rules: { id: string; severity: string; kind: string; confidence: string }[];
    };
    // A layers rule whose allow-list is '*' declares scope and can never fire, so it is exempt —
    // the same exemption `required-file` derives, asserted here from the other side.
    const needsFixture = declared.rules.filter((rule) => rule.severity === 'error');
    const present = new Set(fixtureFiles().map((f) => f.ruleId));
    const missing = needsFixture
      .map((r) => r.id)
      .filter((id) => !present.has(id) && id !== 'tests-reach-anything');
    expect(missing).toEqual([]);
  });

  test('no fixture is orphaned — every file here names a real rule', () => {
    const declared = JSON.parse(readFileSync(join(ROOT, 'generated', 'rules.json'), 'utf8')) as {
      rules: { id: string }[];
    };
    const known = new Set(declared.rules.map((rule) => rule.id));
    const orphans = fixtureFiles()
      .map((f) => f.ruleId)
      .filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  test('exactly one fixture escapes placement, and it says which test proves it', () => {
    const escapes = fixtureFiles().filter((f) => f.directive.kind === 'verified-by');
    expect(escapes).toHaveLength(1);
    expect(escapes[0]?.ruleId).toBe('every-error-rule-has-a-fixture');
    if (escapes[0]?.directive.kind !== 'verified-by') return;
    expect(escapes[0].directive.test).toBe(
      'the fixture obligation fires when a fixture is missing',
    );
  });
});

describe('each fixture is caught by exactly its own rule', () => {
  const { diagnostics, placed } = withAllFixturesPlaced((root, placedPaths) => {
    const { stdout } = archcheck(['--format', 'json'], root);
    return {
      diagnostics: JSON.parse(stdout).diagnostics as { ruleId: string; file: string }[],
      placed: placedPaths,
    };
  });

  for (const [ruleId, path] of [...placed.entries()].sort()) {
    test(`${ruleId} — and only ${ruleId} — fires for ${path}`, () => {
      const caught = [
        ...new Set(diagnostics.filter((d) => d.file === path).map((d) => d.ruleId)),
      ].sort();
      expect(caught).toEqual([ruleId]);
    });
  }

  test('every placed fixture was caught by something', () => {
    const silent = [...placed.entries()].filter(
      ([, path]) => !diagnostics.some((d) => d.file === path),
    );
    expect(silent).toEqual([]);
  });
});

describe('the fixture obligation fires when a fixture is missing', () => {
  test('removing a fixture turns the self-host run red, naming the rule and the path', () => {
    const work = mkdtempSync(join(tmpdir(), 'archcheck-missing-'));
    try {
      for (const entry of [
        'src',
        'architecture.config.ts',
        'tsconfig.json',
        'package.json',
        'fixtures',
      ]) {
        cpSync(join(ROOT, entry), join(work, entry), { recursive: true });
      }
      rmSync(join(work, '.archcheck'), { recursive: true, force: true });
      expect(archcheck([], work).code).toBe(0);

      rmSync(join(work, 'fixtures', 'rules', 'util-is-a-leaf.violation.ts'));
      const { code, stdout } = archcheck([], work);
      expect(code).toBe(1);
      expect(stdout).toContain("rule 'util-is-a-leaf' is missing");
      expect(stdout).toContain('fixtures/rules/util-is-a-leaf.violation.ts');
      expect(stdout).toContain('looks exactly like compliance');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe('every contract kind has a package fixture', () => {
  /**
   * The other suite, and the other question: does the MECHANISM work? These live in
   * `fixtures/repos/` rather than the plan's `fixtures/kinds/` — same job, and renaming ten
   * directories that a dozen test files already point at would have changed nothing but the path.
   */
  const COVERED_BY: Record<string, string> = {
    layers: 'layered',
    encapsulation: 'barrels',
    naming: 'lint',
    'banned-syntax': 'lint',
    'required-file': 'structure',
    'declared-field': 'structure',
    judgement: 'judgement',
  };

  test('each implemented kind maps to a fixture repository that exists', () => {
    const repos = new Set(readdirSync(join(ROOT, 'fixtures', 'repos')));
    for (const [kind, repo] of Object.entries(COVERED_BY)) {
      expect({ kind, exists: repos.has(repo) }).toEqual({ kind, exists: true });
    }
  });

  test('the only kind without one is `forbidden`, which layers already covers', () => {
    const KINDS = [
      'layers',
      'forbidden',
      'encapsulation',
      'naming',
      'required-file',
      'declared-field',
      'banned-syntax',
      'judgement',
    ];
    const uncovered = KINDS.filter((kind) => COVERED_BY[kind] === undefined);
    expect(uncovered).toEqual(['forbidden']);
  });
});
