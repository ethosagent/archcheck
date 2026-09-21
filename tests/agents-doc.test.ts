/**
 * AGENTS.md cites files, symbols and rule ids. Rule 12 of that document says a citation names
 * something real; this suite is what makes rule 12 true of the document itself.
 *
 * A stale operating contract is worse than none: an agent follows it, the path does not exist, and
 * it either guesses or stops.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const AGENTS = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
const CLAUDE = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');

describe('the ponytail ladder is followable from AGENTS.md alone', () => {
  test('the skill file is where AGENTS.md says it is', () => {
    expect(existsSync(join(ROOT, '.agents', 'skills', 'ponytail', 'SKILL.md'))).toBe(true);
  });

  test('.claude/skills resolves to it, so a Claude session loads the same file', () => {
    expect(readFileSync(join(ROOT, '.claude', 'skills', 'ponytail', 'SKILL.md'), 'utf8')).toBe(
      readFileSync(join(ROOT, '.agents', 'skills', 'ponytail', 'SKILL.md'), 'utf8'),
    );
  });

  test('all seven rungs are restated in AGENTS.md, so the name is not load-bearing', () => {
    for (const rung of [
      'Does this need to be built at all?',
      'Does it already exist in this codebase?',
      'Does the standard library already do this?',
      'Does a native platform feature cover it?',
      'Does an installed dependency solve it?',
      'Can this be one line?',
      'write the minimum code that works',
    ]) {
      expect({ rung, present: AGENTS.includes(rung) }).toEqual({ rung, present: true });
    }
  });

  test('the grep it tells an agent to run finds something', () => {
    expect(AGENTS).toContain("grep -rn 'ponytail:' src");
    const found = execFileSync('grep', ['-rn', 'ponytail:', 'src'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    expect(found.length).toBeGreaterThan(0);
  });

  test('it states no COUNT of those markers — a number in prose drifts, and it did', () => {
    // It said "there are two in src/" while there were three. The sentence now names the grep
    // and no number, so the only way to be wrong is to delete the marker convention entirely.
    expect(AGENTS).not.toMatch(/There are (two|three|four|\d+) in `src\/`/);
  });
});

describe('CLAUDE.md points at AGENTS.md and holds nothing else', () => {
  test('it links to AGENTS.md', () => {
    expect(CLAUDE).toContain('[AGENTS.md](AGENTS.md)');
  });

  test('it stays a pointer — the content lives in one place, so the two cannot drift apart', () => {
    // A pointer cannot diverge from what it points at. A copy can.
    expect(CLAUDE.split('\n').length).toBeLessThan(20);
    expect(CLAUDE).not.toContain('## 1.');
  });
});

describe('every path AGENTS.md cites exists', () => {
  const paths = [
    ...new Set(
      [...AGENTS.matchAll(/\[[^\]]+\]\((?!https?:)([^)#]+)\)/g)].map((match) => match[1] ?? ''),
    ),
  ].sort();

  test('it links the four documents an agent has to open', () => {
    // Named rather than counted: a count passes when the important link is the one that went
    // missing.
    for (const required of [
      'architecture.config.ts',
      'RULES.md',
      'scripts/run-checks.sh',
      '.agents/skills/ponytail/SKILL.md',
    ]) {
      expect({ required, linked: paths.includes(required) }).toEqual({ required, linked: true });
    }
  });

  for (const path of paths) {
    test(path, () => {
      expect({ path, exists: existsSync(join(ROOT, path)) }).toEqual({ path, exists: true });
    });
  }
});

describe('every backticked source path AGENTS.md names exists', () => {
  /**
   * A line saying a file "was never created" is citing its ABSENCE — that is the ponytail rung-2
   * example, and asserting the file exists would invert its meaning. Everything else must be real.
   */
  const citedAsAbsent = new Set(
    AGENTS.split('\n')
      .filter((line) => line.includes('was never created'))
      .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '')),
  );

  const paths = [
    ...new Set(
      [...AGENTS.matchAll(/`((?:src|tests|scripts|fixtures|examples|generated|\.github)\/[^`]*)`/g)]
        .map((match) => (match[1] ?? '').replace(/\/\*\*$/, '').replace(/\/$/, ''))
        .filter((path) => !path.includes('*') && !path.includes('<'))
        .filter((path) => !citedAsAbsent.has(path)),
    ),
  ].sort();

  test('a path cited as absent really is absent', () => {
    expect(citedAsAbsent.size).toBeGreaterThan(0);
    for (const path of citedAsAbsent) {
      expect({ path, exists: existsSync(join(ROOT, path)) }).toEqual({ path, exists: false });
    }
  });

  for (const path of paths) {
    test(path, () => {
      expect({ path, exists: existsSync(join(ROOT, path)) }).toEqual({ path, exists: true });
    });
  }
});

describe('every rule id AGENTS.md cites is in the manifest', () => {
  const declared = new Set(
    (
      JSON.parse(readFileSync(join(ROOT, 'generated', 'rules.json'), 'utf8')) as {
        rules: { id: string }[];
      }
    ).rules.map((rule) => rule.id),
  );

  const cited = [
    'only-the-facade-wires-layers',
    'kernel-imports-nothing',
    'no-console-outside-an-entry-point',
    'every-error-rule-has-a-fixture',
  ];

  test('the list below is the one AGENTS.md actually names', () => {
    for (const id of cited) expect(AGENTS).toContain(id);
  });

  for (const id of cited) {
    test(`${id} is a real rule`, () => {
      expect({ id, declared: declared.has(id) }).toEqual({ id, declared: true });
    });
  }
});

describe('the symbols AGENTS.md names exist in the files it names', () => {
  const claims: [string, string][] = [
    ['src/normalize/identity.ts', 'computeIdentity'],
    ['src/probes/model/prompt.ts', 'renderFileBlock'],
    ['src/archcheck.ts', 'exitCodeFor'],
    ['src/probes/types.ts', 'handles'],
    ['src/contracts/types.ts', 'refine'],
    ['src/contracts/types.ts', 'warn'],
  ];

  for (const [path, symbol] of claims) {
    test(`${symbol} in ${path}`, () => {
      expect(readFileSync(join(ROOT, path), 'utf8')).toContain(symbol);
    });
  }
});

describe('the layout table covers every layer the manifest declares', () => {
  test('a layer nobody documented is a layer nobody knows the rules for', () => {
    const graph = require(join(ROOT, 'generated', 'graph.config.cjs')) as {
      layers: { layer: string }[];
    };
    const table = AGENTS.split('## The layout, in one table')[1] ?? '';
    expect(table).not.toBe('');
    const undocumented = graph.layers
      .map((entry) => entry.layer)
      .filter((name) => !table.includes(name));
    expect(undocumented).toEqual([]);
  });
});

describe('the commands AGENTS.md tells an agent to run are real', () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  test('`bun run check` exists, and AGENTS.md names it', () => {
    expect(scripts.scripts.check).toBeDefined();
    expect(AGENTS).toContain('bun run check');
  });

  test('it never instructs a pnpm command, which this repository has no script for', () => {
    // The rules arrived phrased for a pnpm monorepo. The word may appear in a note explaining the
    // substitution; a COMMAND may not, because an agent would run it and get nothing.
    const commands = [...AGENTS.matchAll(/pnpm (check|test|typecheck|lint|run|install)/g)];
    expect(commands.map((match) => match[0])).toEqual([]);
  });

  test('every mention of the absent ARCHITECTURE.md sits inside a substitution note', () => {
    expect(existsSync(join(ROOT, 'ARCHITECTURE.md'))).toBe(false);
    const lines = AGENTS.split('\n').filter((line) => line.includes('ARCHITECTURE.md'));
    expect(lines.length).toBeGreaterThan(0);
    // A blockquote. If it ever appears as a plain instruction, it is telling an agent to read a
    // file that is not here.
    for (const line of lines) expect(line.trimStart().startsWith('>')).toBe(true);
  });

  test('the same holds for pnpm and packages/types', () => {
    for (const token of ['pnpm', 'packages/types']) {
      for (const line of AGENTS.split('\n').filter((l) => l.includes(token))) {
        expect({ token, inNote: line.trimStart().startsWith('>') }).toEqual({
          token,
          inNote: true,
        });
      }
    }
  });

  test('every gate it tabulates is a real script', () => {
    for (const gate of ['typecheck', 'lint', 'tests', 'emit', 'selfhost']) {
      const script = gate === 'tests' ? 'check-tests.sh' : `check-${gate}.sh`;
      expect({ gate, exists: existsSync(join(ROOT, 'scripts', script)) }).toEqual({
        gate,
        exists: true,
      });
    }
  });
});
