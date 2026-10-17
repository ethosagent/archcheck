/**
 * Prove every fixture still trips the rule it was written for.
 *
 * Why this exists: `required-file` with `forEach: 'rule[severity=error]'` proves a fixture FILE
 * exists for each error rule. It does not prove the fixture still FAILS. A fixture whose rule
 * changed shape, whose path moved, or whose violating line somebody tidied away still satisfies
 * that gate — and looks exactly like compliance, which is the failure the README warns about.
 *
 * What a caller must know: each fixture is placed in a scratch copy of the project and the checks
 * are RUN there. Nothing is inferred from reading the fixture, because a fixture that only looks
 * like a violation is the thing being tested for.
 */
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
import { readDirective } from './directive.js';

/** What one fixture turned out to prove, or fail to. */
export type FixtureResult = {
  ruleId: string;
  fixture: string;
  /** True when the rule this fixture is named for produced a finding from it. */
  tripped: boolean;
  /** Other rules the fixture also tripped. Information, not a failure. */
  alsoTripped: readonly string[];
  /** Set when the fixture could not be verified at all. */
  problem?: string;
};

export type VerifyOptions = {
  /** The project the fixtures belong to. */
  root: string;
  /** Where the `<id>.violation.*` files live. */
  dir: string;
  /** The CLI entry point to run in the scratch copy. */
  cli: string;
  /** Top-level entries to copy. Keeping this explicit avoids copying node_modules. */
  copy: readonly string[];
};

/** The fixtures in a directory, as rule ids. A name is the rule it proves. */
export function fixtureNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.includes('.violation.'))
    .sort();
}

function ruleIdOf(fixtureName: string): string {
  return fixtureName.slice(0, fixtureName.indexOf('.violation.'));
}

function findingsIn(cli: string, work: string): { ruleId: string; file: string }[] {
  try {
    const stdout = execFileSync('bun', ['run', cli, '--cwd', work, '--format', 'json'], {
      cwd: work,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseFindings(stdout);
  } catch (error) {
    // A run WITH violations exits 1, so a non-zero status is the normal case here. Only a run
    // that printed no parseable report is a real failure, and that is decided by the parse.
    const said = (error as { stdout?: string }).stdout;
    return parseFindings(said ?? '');
  }
}

function parseFindings(stdout: string): { ruleId: string; file: string }[] {
  try {
    const report = JSON.parse(stdout) as { diagnostics?: { ruleId?: unknown; file?: unknown }[] };
    const diagnostics = report.diagnostics ?? [];
    return diagnostics.flatMap((entry) =>
      typeof entry.ruleId === 'string' && typeof entry.file === 'string'
        ? [{ ruleId: entry.ruleId, file: entry.file }]
        : [],
    );
  } catch {
    // Not a report. The caller turns an empty list into "this fixture tripped nothing", which is
    // the honest reading: no evidence that it still catches anything.
    return [];
  }
}

/** Place one fixture in a scratch copy and run the checks there. */
function verifyOne(options: VerifyOptions, fixtureName: string): FixtureResult {
  const ruleId = ruleIdOf(fixtureName);
  const source = readFileSync(join(options.dir, fixtureName), 'utf8');
  const directive = readDirective(source);
  const base: FixtureResult = { ruleId, fixture: fixtureName, tripped: false, alsoTripped: [] };

  if (directive === undefined) {
    return { ...base, problem: 'has no archcheck-fixture directive saying where it belongs' };
  }
  if (directive.kind === 'verified-by') {
    return { ...base, tripped: true, problem: undefined };
  }

  const work = mkdtempSync(join(tmpdir(), 'archcheck-verify-'));
  try {
    for (const entry of options.copy) {
      cpSync(join(options.root, entry), join(work, entry), { recursive: true });
    }
    const target = join(work, directive.path);
    mkdirSync(dirname(target), { recursive: true });
    if (directive.kind === 'append-to') appendFileSync(target, `\n${source}`);
    else writeFileSync(target, source);

    const findings = findingsIn(options.cli, work);
    const mine = findings.filter((finding) => finding.ruleId === ruleId);
    const others = [...new Set(findings.map((f) => f.ruleId))].filter((id) => id !== ruleId);
    const tripped = mine.length > 0;
    // A fixture that trips SOMETHING ELSE is almost always sitting in the wrong place: the rule it
    // is named for matches on a path, and the fixture landed outside it. Saying that is worth more
    // than reporting a bare failure, because it names the one field likely to be wrong.
    const misplaced =
      !tripped && others.length > 0
        ? `tripped ${others.join(', ')} instead — check the place-at path '${directive.path}'`
        : undefined;
    return {
      ...base,
      tripped,
      alsoTripped: others.sort(),
      ...(misplaced === undefined ? {} : { problem: misplaced }),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Every fixture in the directory, verified by running the checks against it. */
export function verifyFixtures(options: VerifyOptions): FixtureResult[] {
  return fixtureNames(options.dir).map((name) => verifyOne(options, name));
}
