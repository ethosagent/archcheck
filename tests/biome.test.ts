/**
 * The Biome adapter, proven against the real Biome.
 *
 * Why this suite exists rather than an assertion about shape: a generated config that merely looks
 * right is the failure this adapter can have without anybody noticing. Biome rejects a config it
 * does not understand by refusing to lint AT ALL, so a wrong key does not produce a wrong finding
 * — it produces silence, in the editor, for every rule the project has.
 *
 * So this runs the binary in `node_modules`, which is the version `package.json` resolves to. That
 * also means a Biome upgrade re-proves the claim instead of invalidating it quietly.
 *
 * The ESLint half of this (#11) has no equivalent, for one honest reason: Biome is already a
 * devDependency of this repository and ESLint is not. Proving the ESLint fragment the same way
 * would mean adding a dependency to run one test, so that claim rests on a manual run.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { archcheckBiomeConfig, archcheckBiomeOverrides } from '../src/adapters/biome.js';
import { childEnv } from './childEnv.js';

const ROOT = join(import.meta.dir, '..');
const BIOME = join(ROOT, 'node_modules', '.bin', 'biome');

/** The sink `emit` would write, for a manifest with one import ban and one console ban. */
const SINK = {
  $generated: { by: 'archcheck', doNotEdit: true },
  rules: [
    {
      ruleId: 'the-domain-decides',
      files: ['src/domain/**'],
      forbid: 'import-path-matching',
      patterns: ['src/service/**'],
      message: 'the domain decides, and never calls a service — invert the call',
    },
    {
      ruleId: 'a-library-writes-to-no-stream',
      files: ['src/**'],
      forbid: 'member-access',
      target: 'console',
      message: 'a library writes to no stream — return the value instead',
    },
    // Three archcheck can state and Biome cannot. They must reach `unexpressed`, not the config.
    {
      ruleId: 'no-empty-catch',
      files: ['src/**'],
      forbid: 'empty-catch',
      message: 'a catch that swallows an error hides a bug',
    },
    {
      ruleId: 'no-inline-suppression',
      files: ['src/**'],
      forbid: 'suppression-comment',
      message: 'an exception lives in the manifest, with an owner and an expiry',
    },
    {
      ruleId: 'no-clock-in-a-rule',
      files: ['src/**'],
      forbid: 'member-access',
      target: 'Date.now',
      message: 'a rule is pure: it reads no clock',
    },
  ],
};

/**
 * Write a project that uses the fragment, run Biome over it, and return what Biome said.
 *
 * `preset: 'none'` turns every rule Biome ships off, so anything reported came from the generated
 * fragment and nothing else. The formatter and the assist are off for the same reason.
 */
function inProject(files: Record<string, string>): { code: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'archcheck-biome-'));
  try {
    const generated = join(root, 'generated');
    mkdirSync(generated, { recursive: true });
    writeFileSync(join(generated, 'lint.overrides.json'), `${JSON.stringify(SINK, null, 2)}\n`);

    const config = {
      formatter: { enabled: false },
      assist: { enabled: false },
      linter: { enabled: true, rules: { preset: 'none' } },
      ...archcheckBiomeOverrides(generated),
    };
    writeFileSync(join(root, 'biome.json'), `${JSON.stringify(config, null, 2)}\n`);

    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }

    // `cwd` is the project, not this repository. Biome resolves its config from the WORKING
    // DIRECTORY and not from the path it is given, so running this from the repo root silently
    // linted the fixture against archcheck's own biome.json — which reported `noConsole` from the
    // recommended set and never read the generated fragment at all.
    const run = spawnSync(BIOME, ['lint', '.'], {
      cwd: root,
      encoding: 'utf8',
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (run.error) throw new Error(`could not run ${BIOME}: ${run.error.message}`);
    return { code: run.status ?? 1, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the generated fragment is a config Biome accepts', () => {
  test('a clean project lints clean, so no key in the fragment was rejected', () => {
    // The point of this case. Biome answers a config it cannot parse by linting NOTHING, so a
    // wrong key looks exactly like a clean repository until somebody plants a violation.
    const { code, output } = inProject({
      'src/domain/pure.ts': 'export const add = (a: number, b: number): number => a + b;\n',
    });
    expect(output).not.toContain('deserialize');
    expect(output).not.toContain('Found an unknown key');
    expect(code).toBe(0);
  });

  test('an import the manifest bans is reported, with the rule’s own sentence', () => {
    const { code, output } = inProject({
      'src/domain/calls.ts':
        "import { write } from 'src/service/write.js';\nexport const x = write;\n",
    });
    expect(code).toBe(1);
    expect(output).toContain('lint/style/noRestrictedImports');
    expect(output).toContain('the domain decides, and never calls a service — invert the call');
  });

  test('a banned global is reported, and the sentence arrives as the note', () => {
    // Biome writes its own headline for this rule and attaches the configured message underneath,
    // which is why the assertion reads the note rather than the first line.
    const { code, output } = inProject({
      'src/domain/logs.ts': 'export const show = (n: number): void => {\n  console.log(n);\n};\n',
    });
    expect(code).toBe(1);
    expect(output).toContain('lint/style/noRestrictedGlobals');
    expect(output).toContain('a library writes to no stream — return the value instead');
  });

  test('a file outside the rule’s own glob is left alone', () => {
    // `includes` carries the rule's `files`, so a ban scoped to src/domain/** must not reach
    // elsewhere. A fragment that ignored the scope would be louder than the gate.
    const { code } = inProject({
      'src/other/calls.ts':
        "import { write } from 'src/service/write.js';\nexport const x = write;\n",
    });
    expect(code).toBe(0);
  });
});

describe('what Biome cannot express is named, never dropped', () => {
  test('the three kinds with no Biome rule come back by id', () => {
    const root = mkdtempSync(join(tmpdir(), 'archcheck-biome-sink-'));
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'lint.overrides.json'), `${JSON.stringify(SINK, null, 2)}\n`);
      const { overrides, unexpressed } = archcheckBiomeConfig(root);
      // `no-clock-in-a-rule` is the interesting one: its target is DOTTED, and the Biome rule that
      // would express it is in nursery, which is unstable and must not reach a committed file.
      expect(unexpressed).toEqual([
        'no-clock-in-a-rule',
        'no-empty-catch',
        'no-inline-suppression',
      ]);
      expect(overrides).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a project that has not run emit yet gets an empty fragment, not a crash', () => {
    expect(archcheckBiomeConfig(join(tmpdir(), 'archcheck-no-such-dir'))).toEqual({
      overrides: [],
      unexpressed: [],
    });
  });
});
