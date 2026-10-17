/**
 * The CLI, end to end, as an agent actually meets it: a subprocess and an exit code.
 *
 * Exit codes are an API — an agent branches on them — so there is one test per code, driven
 * through the real binary rather than through the facade.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { implementedKinds } from '../src/contracts/index.js';
import { renderManifest } from '../src/init/index.js';
import { CONTRACT_KINDS } from '../src/types.js';
import { DEFAULT_TEST_GLOBS } from '../src/util/testEdges.js';
import { childEnv } from './childEnv.js';

const ROOT = join(import.meta.dir, '..');
const CLI = join(ROOT, 'src', 'cli', 'index.ts');
const fixture = (name: string) => join(ROOT, 'fixtures', 'repos', name);

/**
 * spawnSync, not execFileSync: a warning printed by a command that SUCCEEDS is invisible to
 * execFileSync, which hands back stdout only. That is precisely where `emit`'s "no configuration
 * was generated for this kind" line lives.
 */
function archcheck(
  args: string[],
  cwd = ROOT,
  entry = CLI,
): { code: number; stdout: string; stderr: string } {
  const run = spawnSync('bun', ['run', entry, ...args], {
    cwd,
    encoding: 'utf8',
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // A process that never started is not an exit code. `1` is archcheck's "new violations", so
  // mapping an EAGAIN/ENOENT spawn failure onto it forges a finding and discards `run.error`.
  if (run.error || (run.status === null && run.signal === null)) {
    throw new Error(
      `could not start \`bun run ${entry}\` in ${cwd}: ${run.error?.message ?? 'no exit status and no signal'}`,
    );
  }
  return { code: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

function inCopyOf<T>(name: string, body: (root: string) => T): T {
  const work = mkdtempSync(join(tmpdir(), `archcheck-${name}-`));
  try {
    cpSync(fixture(name), work, { recursive: true });
    rmSync(join(work, '.archcheck'), { recursive: true, force: true });
    return body(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('the harness itself — a spawn that never started is not an exit code', () => {
  test('archcheck() throws, naming the command and the reason, when bun cannot be started', () => {
    // Rule 17 in the tests: `1` is archcheck's code for "new violations", so a helper that maps an
    // unstartable process to 1 makes an EAGAIN/ENOENT spawn failure indistinguishable from a real
    // finding. One failure under load was already unattributable because the reason was discarded.
    const path = process.env.PATH ?? '';
    process.env.PATH = join(ROOT, 'no-such-directory');
    try {
      expect(() => archcheck(['--version'])).toThrow(/bun/);
      expect(() => archcheck(['--version'])).toThrow(/ENOENT|not found/);
    } finally {
      process.env.PATH = path;
    }
  });
});

describe('exit code 0 — clean', () => {
  test('a repository that breaks no rule exits 0 and says so', () => {
    const { code, stdout } = archcheck(['--cwd', fixture('clean')]);
    expect(code).toBe(0);
    expect(stdout).toContain('nothing to fix');
  });
});

describe('exit code 1 — new violations of error-severity rules', () => {
  test('the planted violation exits 1', () => {
    const { code, stdout } = archcheck(['--cwd', fixture('layered')]);
    expect(code).toBe(1);
    expect(stdout).toContain('domain may not import service');
    expect(stdout).toContain('modules/ledger/domain/supersede.ts:3');
    expect(stdout).toContain('invert the call');
  });

  test('a warn-severity rule does NOT exit 1 — only error blocks', () => {
    inCopyOf('layered', (root) => {
      const config = join(root, 'architecture.config.ts');
      writeFileSync(
        config,
        readFileSync(config, 'utf8').replace(
          "severity: 'error' as const",
          "severity: 'warn' as const",
        ),
      );
      const { code, stdout } = archcheck(['--cwd', root]);
      expect(code).toBe(0);
      // Reported, just not blocking.
      expect(stdout).toContain('domain may not import service');
    });
  });
});

describe('sibling units inside one layer', () => {
  /**
   * The fixture carries three legal edges beside the one illegal one: an import inside the cart
   * unit, and the shared layer imported from both units. A second finding would mean the rule
   * matches more than it claims, which is the failure a fixture exists to catch.
   */
  test('a cross-unit import is the only finding, and it names both units', () => {
    const { code, stdout } = archcheck(['--cwd', fixture('siblings')]);
    expect(code).toBe(1);
    expect(stdout).toContain('src/features/cart may not import src/features/checkout');
    expect(stdout).toContain('src/features/cart/index.ts:1');
    expect(stdout).toContain('1 deterministic');
    expect(stdout).not.toContain('total.ts');
    expect(stdout).not.toContain('money.ts');
  });
});

describe('the forbidden kind', () => {
  /**
   * Five bans, one fixture: layer to layer, glob to glob, an external package, a cross-DIMENSION
   * ban, and an `except` carve-out that must stay silent. The carve-out is the one worth a test of
   * its own — a rule that bans more than it says is as broken as one that bans nothing.
   */
  test('bans a layer edge, a path edge, a package and a runtime edge, and honours except', () => {
    const { code, stdout } = archcheck(['--cwd', fixture('forbidden')]);
    expect(code).toBe(1);
    expect(stdout).toContain('5 deterministic');
    expect(stdout).toContain('src/cart/direct.ts may not import ../payments/sdk.js');
    expect(stdout).toContain('src/checkout/index.ts may not import ../payments/sdk.js');
    expect(stdout).toContain('src/checkout/report.ts may not import lodash/fp.js');
    expect(stdout).toContain('src/cart/reach.ts may not import ../checkout/index.js');
    // The second axis: client code may not call a server module in process.
    expect(stdout).toContain('src/widget/view.ts may not import ../handler/api.js');
    // src/legacy/allowed.ts imports the checkout too, and is excepted.
    expect(stdout).not.toContain('src/legacy/allowed.ts');
    // server to server is the same runtime, so the ban is silent there — a cross-dimension rule
    // that fires on both directions would be banning the axis, not the edge across it.
    expect(stdout).not.toContain('src/handler/inner.ts');
  });
});

describe('the dependency audit', () => {
  /**
   * The fourth criterion of the externals work (#2), split out as #39. `externals` answers "may
   * this layer reach this package", a question about one import. This answers "is this dependency
   * approved at all", a question about the repository — and a dependency nothing imports has no
   * edge to hang a finding on, which is the case worth catching.
   */
  test('a dependency no layer allows is reported against package.json', () => {
    const { code, stdout } = archcheck(['--cwd', fixture('dependencies')]);
    expect(code).toBe(1);
    expect(stdout).toContain('left-pad is a dependency no layer may import');
    expect(stdout).toContain('package.json');
    // The approved set is named, so a reader knows where to put the dependency.
    expect(stdout).toContain('allowed: zod');
    // `zod` is on a layer's allow-list and `bun-types` is declared unassigned. Both silent.
    expect(stdout).not.toContain('zod is a dependency');
    expect(stdout).not.toContain('bun-types');
  });

  test('devDependencies are audited only when the rule asks for them', () => {
    // vitest is a devDependency no layer allows. Silent by default — a dev tool is not part of
    // the architecture — and reported once the rule says to look.
    expect(archcheck(['--cwd', fixture('dependencies')]).stdout).not.toContain('vitest');

    inCopyOf('dependencies', (root) => {
      const manifest = join(root, 'architecture.config.ts');
      const source = readFileSync(manifest, 'utf8');
      writeFileSync(
        manifest,
        source.replace(
          'auditsDependencies: true,',
          'auditsDependencies: true,\n        auditsDevDependencies: true,',
        ),
      );
      const { stdout } = archcheck(['--cwd', root]);
      expect(stdout).toContain('vitest is a dependency no layer may import');
      expect(stdout).toContain('left-pad is a dependency no layer may import');
    });
  });

  test('a manifest with no externals audits nothing, so the check is opt-in twice over', () => {
    // Two opt-ins, and the second is not pedantry. With the flag alone and no allow-list, NOTHING
    // is approved by anybody, so every dependency would be a finding — noise, not a result.
    inCopyOf('dependencies', (root) => {
      const manifest = join(root, 'architecture.config.ts');
      const source = readFileSync(manifest, 'utf8');
      writeFileSync(manifest, source.replace("externals: { allow: ['zod'] },", ''));
      const { code, stdout } = archcheck(['--cwd', root]);
      expect(stdout).not.toContain('is a dependency no layer may import');
      expect(code).toBe(0);
    });
  });

  test('two rules claiming the audit is a config error, not a double report', () => {
    inCopyOf('dependencies', (root) => {
      const manifest = join(root, 'architecture.config.ts');
      const source = readFileSync(manifest, 'utf8');
      writeFileSync(
        manifest,
        source.replace(
          "params: { name: 'service', match: 'src/service/**', mayImport: ['domain'] },",
          "params: {\n        name: 'service',\n        match: 'src/service/**',\n        mayImport: ['domain'],\n        auditsDependencies: true,\n      },",
        ),
      );
      const { code, stderr } = archcheck(['--cwd', root]);
      expect(code).toBe(2);
      expect(stderr).toContain('params.auditsDependencies is set on 2 rules');
      expect(stderr).toContain('exactly one layers rule owns the dependency audit');
    });
  });
});

describe('coveredBy, end to end', () => {
  /**
   * `coveredBy` is a rule-level FIELD, not a kind, so the structure probe has to run for a reason
   * other than `handles` — that is what `Probe.appliesTo` exists for.
   *
   * The clean fixture declares two `layers` rules and nothing the structure probe handles. So if
   * the facade ignored `appliesTo`, the probe would not run, the claim would never be checked, and
   * the run would say the repository is clean. Nothing in the suite caught that until this test:
   * removing the `appliesTo` call from the facade left every other test green.
   */
  test('a rule of a kind the probe does not handle is still checked', () => {
    inCopyOf('clean', (root) => {
      const manifest = join(root, 'architecture.config.ts');
      const source = readFileSync(manifest, 'utf8');
      writeFileSync(
        manifest,
        source.replace(
          "      remedy: { summary: 'move the shared type into contracts, or stop sharing it' },",
          "      coveredBy: { tests: ['test/no-such-file.test.ts'] },\n" +
            "      remedy: { summary: 'move the shared type into contracts, or stop sharing it' },",
        ),
      );
      const { code, stdout } = archcheck(['--cwd', root]);
      expect(code).toBe(1);
      expect(stdout).toContain('contracts-import-nothing is covered by');
      expect(stdout).toContain('no file matches it');
    });
  });

  test('a claim that holds is silent, so the check is not merely loud', () => {
    inCopyOf('clean', (root) => {
      const manifest = join(root, 'architecture.config.ts');
      const source = readFileSync(manifest, 'utf8');
      writeFileSync(
        join(root, 'kernel.test.ts'),
        "test('the kernel imports nothing', () => {});\n",
      );
      writeFileSync(
        manifest,
        source.replace(
          "      remedy: { summary: 'move the shared type into contracts, or stop sharing it' },",
          "      coveredBy: { tests: ['kernel.test.ts'], name: 'the kernel imports nothing' },\n" +
            "      remedy: { summary: 'move the shared type into contracts, or stop sharing it' },",
        ),
      );
      const { code, stdout } = archcheck(['--cwd', root]);
      expect(stdout).not.toContain('is covered by');
      expect(code).toBe(0);
    });
  });
});

describe('production code reaches for no test', () => {
  /**
   * #6's second criterion, which #31 could not deliver: it needed a rule form that bans an edge TO
   * a test file or to a package, and `forbidden` did not exist yet.
   *
   * The control is the whole point. `src/domain/price.test.ts` imports the same test helper and the
   * same testing library as `src/domain/price.ts`. Both are legitimate there, and `edges:
   * 'production'` is what tells the two apart — so a rule that fired on both would be banning the
   * tests, not the production code reaching into them.
   */
  test('a production file importing a test file or a testing library fails', () => {
    const { code, stdout } = archcheck(['--cwd', fixture('test-imports')]);
    expect(code).toBe(1);
    expect(stdout).toContain('src/domain/price.ts may not import ./fakes.test.js');
    expect(stdout).toContain('src/domain/price.ts may not import vitest');
    expect(stdout).toContain('2 deterministic');
  });

  test('the test file doing exactly the same two things is silent', () => {
    const { stdout } = archcheck(['--cwd', fixture('test-imports')]);
    expect(stdout).not.toContain('src/domain/price.test.ts');
  });

  test('archcheck init ships both bans, so a new repository gets them', () => {
    // A default nobody generates is a default nobody has. These two are the only generated rules
    // that need the `tests` globs, so they are the ones most likely to be dropped by accident.
    const generated = renderManifest([{ name: 'domain', match: 'src/**' }], new Map());
    expect(generated).toContain("id: 'production-code-does-not-import-a-test-file'");
    expect(generated).toContain("id: 'production-code-does-not-import-a-testing-library'");
    expect(generated).toContain("edges: 'production'");
    // Rendered from DEFAULT_TEST_GLOBS, so the ban and the `tests` default cannot drift apart.
    for (const glob of DEFAULT_TEST_GLOBS) expect(generated).toContain(glob);
  });
});

describe('exit code 2 — configuration invalid', () => {
  test('an unknown layer in mayImport exits 2, naming the rule and the field', () => {
    const { code, stderr } = archcheck(['--cwd', fixture('broken-manifest')]);
    expect(code).toBe(2);
    expect(stderr).toContain("rules[0] 'points-at-a-layer-that-does-not-exist'");
    expect(stderr).toContain('params.mayImport names an unknown layer');
  });

  test('a missing manifest exits 2, not 1 — an agent must not go editing source', () => {
    const empty = mkdtempSync(join(tmpdir(), 'archcheck-empty-'));
    try {
      const { code, stderr } = archcheck(['--cwd', empty]);
      expect(code).toBe(2);
      expect(stderr).toContain('no architecture.config.ts found');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test('an unknown flag exits 2 — a typo must never read as success', () => {
    const { code, stderr } = archcheck(['--cwd', fixture('clean'), '--defintely-not-a-flag']);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown flag '--defintely-not-a-flag'");
  });

  test('an unknown --format value exits 2 and lists the valid ones', () => {
    const { code, stderr } = archcheck(['--cwd', fixture('clean'), '--format', 'yaml']);
    expect(code).toBe(2);
    expect(stderr).toContain('--format expects one of terminal, json, json-pretty, sarif, verdict');
  });
});

describe('exit code 3 — emitted output is stale', () => {
  test('a repository that has never emitted is stale', () => {
    inCopyOf('clean', (root) => {
      const { code, stderr } = archcheck(['emit', '--check', '--cwd', root]);
      expect(code).toBe(3);
      expect(stderr).toContain('has never been generated');
      expect(stderr).toContain('npx archcheck emit');
    });
  });

  test('emit then check is clean', () => {
    inCopyOf('clean', (root) => {
      expect(archcheck(['emit', '--cwd', root]).code).toBe(0);
      const after = archcheck(['emit', '--check', '--cwd', root]);
      expect(after.code).toBe(0);
      expect(after.stdout).toContain('up to date');
    });
  });

  test('a hand-edited generated file exits 3 and names the file', () => {
    inCopyOf('clean', (root) => {
      archcheck(['emit', '--cwd', root]);
      const victim = join(root, 'generated', 'graph.config.cjs');
      writeFileSync(victim, `${readFileSync(victim, 'utf8')}\n// someone typed here\n`);

      const { code, stderr } = archcheck(['emit', '--check', '--cwd', root]);
      expect(code).toBe(3);
      expect(stderr).toContain('generated/graph.config.cjs');
      expect(stderr).toContain('hand-edited');
    });
  });

  test('emit writes the id ledger, so ids become immutable from the first run', () => {
    inCopyOf('clean', (root) => {
      archcheck(['emit', '--cwd', root]);
      const ledger = JSON.parse(readFileSync(join(root, '.archcheck', 'ids.json'), 'utf8'));
      expect(ledger.ids).toEqual(['contracts-import-nothing', 'rules-are-pure']);
    });
  });

  test('a rule id removed after emit fails the next load — and says how to fix it', () => {
    inCopyOf('clean', (root) => {
      archcheck(['emit', '--cwd', root]);
      const config = join(root, 'architecture.config.ts');
      const source = readFileSync(config, 'utf8');
      writeFileSync(config, source.replace("id: 'rules-are-pure'", "id: 'rules-are-pure-v2'"));

      const { code, stderr } = archcheck(['--cwd', root]);
      expect(code).toBe(2);
      expect(stderr).toContain('id disappeared: rules-are-pure');
      expect(stderr).toContain("replaces: 'rules-are-pure'");
    });
  });
});

describe('a corrupt id ledger', () => {
  /**
   * A truncated, half-written or badly-merged `.archcheck/ids.json` used to take the same path as
   * "no ledger yet": an empty id list, which passes every rename because there is no recorded id
   * left to disappear. The immutability guarantee switched itself off, silently.
   */
  const TRUNCATED = '{ "schemaVersion": 1, "ids": [trunc';

  function withCorruptLedger(root: string): void {
    writeFileSync(join(root, '.archcheck', 'ids.json'), TRUNCATED);
  }

  test('exits 2 instead of letting a renamed rule through', () => {
    inCopyOf('clean', (root) => {
      expect(archcheck(['emit', '--cwd', root]).code).toBe(0);
      withCorruptLedger(root);
      const config = join(root, 'architecture.config.ts');
      writeFileSync(
        config,
        readFileSync(config, 'utf8').replace("id: 'rules-are-pure'", "id: 'rules-are-pure-v2'"),
      );

      const { code, stderr } = archcheck(['--cwd', root]);
      expect(code).toBe(2);
      expect(stderr).toContain('.archcheck/ids.json');
      expect(stderr).toContain('could not be read');
    });
  });

  test('stops `emit`, which would otherwise rebuild it and erase every id it could not read', () => {
    inCopyOf('clean', (root) => {
      archcheck(['emit', '--cwd', root]);
      withCorruptLedger(root);

      const { code, stderr } = archcheck(['emit', '--cwd', root]);
      expect(code).toBe(2);
      expect(stderr).toContain('could not be read');
      expect(readFileSync(join(root, '.archcheck', 'ids.json'), 'utf8')).toBe(TRUNCATED);
    });
  });

  test('no ledger at all is still the normal first run', () => {
    inCopyOf('clean', (root) => {
      expect(existsSync(join(root, '.archcheck', 'ids.json'))).toBe(false);
      expect(archcheck(['emit', '--cwd', root]).code).toBe(0);
      expect(existsSync(join(root, '.archcheck', 'ids.json'))).toBe(true);
    });
  });
});

describe('every kind in the closed set is implemented', () => {
  /**
   * This test used to assert the opposite, with `forbidden` as its example: a kind in the closed
   * set with no contract type, which `emit` had to name out loud because a CI lane running only
   * `archcheck emit` sees neither `RunResult.skipped` nor `Coverage.unchecked`.
   *
   * `forbidden` shipped, and with it the set is complete, so that test had no subject left and no
   * kind to substitute. Asserting the invariant instead is the stronger guard: it is the thing
   * that fails the day somebody adds a ninth kind to `CONTRACT_KINDS` and does not implement it.
   * The naming mechanism in `emit` stays, dormant by construction, waiting for that kind.
   */
  test('so no manifest can declare a kind that nothing checks', () => {
    const implemented = new Set(implementedKinds());
    const unimplemented = CONTRACT_KINDS.filter((kind) => !implemented.has(kind));
    expect(unimplemented).toEqual([]);
  });

  test('and a clean repository reports nothing unchecked', () => {
    const { code, stdout } = archcheck(['--cwd', fixture('clean')]);
    expect(code).toBe(0);
    expect(stdout).not.toContain('unchecked');
  });
});

describe('--format routes to the right reporter', () => {
  test('json is one line, schema-versioned, and always carries skipped', () => {
    const { stdout } = archcheck(['--cwd', fixture('layered'), '--format', 'json']);
    expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.diagnostics).toHaveLength(2);
    expect(parsed.coverage).toEqual({
      total: 5,
      deterministic: 5,
      proxy: 0,
      model: 0,
      unchecked: 0,
    });
  });

  test('every diagnostic carries a 16-character identity', () => {
    const { stdout } = archcheck(['--cwd', fixture('layered'), '--format', 'json']);
    for (const diagnostic of JSON.parse(stdout).diagnostics) {
      expect(diagnostic.identity).toHaveLength(16);
    }
  });

  test('verdict answers one question, and names the reason', () => {
    const { stdout } = archcheck(['--cwd', fixture('layered'), '--format', 'verdict']);
    const verdict = JSON.parse(stdout);
    expect(verdict.block).toBe(true);
    expect(verdict.reason).toContain('domain may not import service');
    expect(verdict.diagnostics.length).toBeGreaterThan(0);
  });

  test('verdict does not block a clean tree', () => {
    const { stdout, code } = archcheck(['--cwd', fixture('clean'), '--format', 'verdict']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ block: false, reason: 'no blocking violations' });
  });
});

describe('--changed', () => {
  test('an explicit changed set scopes the run', () => {
    const scoped = archcheck([
      '--cwd',
      fixture('layered'),
      '--changed',
      'modules/ledger/services/write.ts',
      '--format',
      'json',
    ]);
    expect(JSON.parse(scoped.stdout).diagnostics).toHaveLength(0);
    expect(scoped.code).toBe(0);
  });

  test('scoping to the importing file keeps the violation', () => {
    const scoped = archcheck([
      '--cwd',
      fixture('layered'),
      '--changed',
      'modules/ledger/domain/supersede.ts',
      '--format',
      'json',
    ]);
    expect(JSON.parse(scoped.stdout).diagnostics).toHaveLength(1);
    expect(scoped.code).toBe(1);
  });

  /**
   * The regression test for "did nothing and exited 0", one level up from the entry-point bug
   * below. `gitChangedFiles` wrapped all three git calls in a bare catch returning `[]`, so git
   * missing from PATH, an unborn HEAD, or a directory outside any work tree scoped the run to
   * NOTHING and reported a clean tree — a pre-commit hook that passes every commit forever.
   *
   * The fixture copy lives under os.tmpdir(), which is outside this repository's work tree, so git
   * really does fail here.
   */
  test('git failing is a config error (2), never an empty changed set', () => {
    inCopyOf('layered', (root) => {
      // The violations are there to be found: the unscoped run exits 1.
      expect(archcheck(['--cwd', root]).code).toBe(1);

      const asked = archcheck(['--cwd', root, '--changed', '--format', 'json']);
      expect(asked.code).toBe(2);
      expect(asked.stderr).toContain('--changed');
      expect(asked.stderr.toLowerCase()).toContain('not a git repository');
      // No report at all: a clean-looking JSON document would be the silent failure itself.
      expect(asked.stdout).toBe('');
    });
  });
});

describe('--only', () => {
  test('deterministic skips the proxy and model tiers', () => {
    inCopyOf('layered', (root) => {
      const config = join(root, 'architecture.config.ts');
      writeFileSync(
        config,
        `${readFileSync(config, 'utf8').replace(
          '  ],\n});',
          `    {
      id: 'controllers-stay-thin',
      kind: 'judgement' as const,
      statement: 'a controller decides nothing',
      severity: 'advisory' as const,
      confidence: 'model' as const,
      params: {
        statement: 'A controller must not decide a business outcome.',
        appliesTo: 'modules/**',
        examples: { pass: ['return decide(x);'], fail: ['if (a > b) return "no";'] },
        cite: 'the deciding branch',
      },
      remedy: { summary: 'move the branch into the domain' },
    },
  ],
});`,
        )}`,
      );

      const all = JSON.parse(archcheck(['--cwd', root, '--format', 'json']).stdout);
      expect(all.coverage.model).toBe(1);
      // The judgement probe runs, finds no credentials, and SAYS SO — a skip with a reason is
      // what lets an agent tell "not judged" apart from "judged and clean".
      expect(all.skipped).toHaveLength(1);
      expect(all.skipped[0].probe).toBe('judgement');
      expect(all.skipped[0].reason).toContain('no ANTHROPIC_API_KEY');

      // --only deterministic never reaches the model tier at all, so there is nothing to skip.
      const only = JSON.parse(
        archcheck(['--cwd', root, '--only', 'deterministic', '--format', 'json']).stdout,
      );
      expect(only.skipped).toEqual([]);
    });
  });
});

describe('explain', () => {
  test('includes the statement, the remedy and the live violation count', () => {
    const { code, stdout } = archcheck([
      'explain',
      'domain-no-service-import',
      '--cwd',
      fixture('layered'),
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('domain may import only contracts and rules');
    expect(stdout).toContain('remedy:     invert the call');
    expect(stdout).toContain('violations: 2');
    expect(stdout).toContain('modules/ledger/domain/supersede.ts');
  });

  test('an unknown rule id exits 2 and lists the known ids', () => {
    const { code, stderr } = archcheck(['explain', 'no-such-rule', '--cwd', fixture('layered')]);
    expect(code).toBe(2);
    expect(stderr).toContain("no rule 'no-such-rule'");
    expect(stderr).toContain('known rules:');
  });

  test('explain with no rule id exits 2 rather than explaining nothing', () => {
    const { code, stderr } = archcheck(['explain', '--cwd', fixture('layered')]);
    expect(code).toBe(2);
    expect(stderr).toContain('explain needs a rule id');
  });
});

describe('coverage', () => {
  test('reports the three computed counts and the automatable percentage', () => {
    const { code, stdout } = archcheck(['coverage', '--cwd', fixture('layered')]);
    expect(code).toBe(0);
    expect(stdout).toContain('✓ 5 deterministic');
    expect(stdout).toContain('◑ 0 proxy');
    expect(stdout).toContain('○ 0 judgement');
    expect(stdout).toContain('5 rules total · 100% automatable');
  });
});

describe('--version and --help', () => {
  test('--version prints a version', () => {
    const { code, stdout } = archcheck(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('--help documents every exit code, because they are the API', () => {
    const { stdout } = archcheck(['--help']);
    for (const code of ['0', '1', '2', '3', '4']) {
      expect(stdout).toContain(`  ${code}  `);
    }
  });
});

describe('--ingest-graph', () => {
  test('a missing graph report is a stated skip, never a silent clean run', () => {
    const { stdout, code } = archcheck([
      '--cwd',
      fixture('layered'),
      '--ingest-graph',
      '--format',
      'json',
    ]);
    const parsed = JSON.parse(stdout);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.skipped[0].probe).toBe('graph');
    expect(parsed.skipped[0].reason).toContain('cannot ingest .archcheck/graph.json');
    // Nothing blocked, but the report says why — an agent can tell this apart from clean.
    expect(code).toBe(0);
  });
});

describe('--write-graph then --ingest-graph', () => {
  test('the report CI writes produces the same findings the direct run does', () => {
    inCopyOf('layered', (root) => {
      const direct = JSON.parse(archcheck(['--cwd', root, '--format', 'json']).stdout);

      const written = archcheck(['--cwd', root, '--write-graph', '--format', 'json']);
      expect(JSON.parse(written.stdout).diagnostics).toEqual(direct.diagnostics);

      const ingested = JSON.parse(
        archcheck(['--cwd', root, '--ingest-graph', '--format', 'json']).stdout,
      );
      expect(ingested.skipped).toEqual([]);
      expect(ingested.diagnostics).toEqual(direct.diagnostics);
    });
  });

  /**
   * The AST kinds, which is the case the layered fixture cannot cover.
   *
   * Until 0.3.2 `banned-syntax` and `declared-field` walked the AST inside the contract, and an
   * ingested graph has facts rather than source files — so on this lane both kinds found nothing,
   * reported no skip, and the run read as clean. The parity test above passed throughout, because
   * the layered fixture declares neither kind. This is the test that would have caught it.
   */
  test('the AST kinds find the same violations on the ingested lane', () => {
    // One fixture per AST kind, with the rule that proves the kind actually ran.
    const lanes = [
      { fixture: 'lint', ruleId: 'no-empty-catch' },
      { fixture: 'structure', ruleId: 'endpoints-declare-a-permission' },
    ];
    for (const lane of lanes) {
      inCopyOf(lane.fixture, (root) => {
        const direct = JSON.parse(archcheck(['--cwd', root, '--format', 'json']).stdout);
        // The fixture has to have something to find, or parity is a comparison of two silences.
        const fired = direct.diagnostics.map((one: { ruleId: string }) => one.ruleId);
        expect(fired).toContain(lane.ruleId);

        archcheck(['--cwd', root, '--write-graph', '--format', 'json']);
        const ingested = JSON.parse(
          archcheck(['--cwd', root, '--ingest-graph', '--format', 'json']).stdout,
        );
        expect(ingested.skipped).toEqual([]);
        expect(ingested.diagnostics).toEqual(direct.diagnostics);
      });
    }
  });

  test('asking to both write and ingest is a config error, not a coin toss', () => {
    const { code, stderr } = archcheck([
      '--cwd',
      fixture('clean'),
      '--write-graph',
      '--ingest-graph',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('mutually exclusive');
  });
});

describe('the barrel ban, end to end', () => {
  test('catches the cross-module deep import and nothing else', () => {
    const { code, stdout } = archcheck(['--cwd', fixture('barrels'), '--format', 'json']);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]).toMatchObject({
      ruleId: 'no-deep-module-imports',
      file: 'modules/graph/build.ts',
      evidence: { module: 'modules/ledger', deepPath: 'domain/supersede.ts' },
    });
  });

  test('the emitted exports map is committed alongside the graph config', () => {
    inCopyOf('barrels', (root) => {
      expect(archcheck(['emit', '--cwd', root]).code).toBe(0);
      const map = JSON.parse(readFileSync(join(root, 'generated', 'exports.json'), 'utf8'));
      expect(map.rules[0].exports).toEqual({ '.': './index.js' });
      expect(map.$generated.doNotEdit).toBe(true);
    });
  });
});

describe('the published CLI runs when invoked under any name', () => {
  /**
   * The regression test for a silent exit-0. The entry point used to guard on `process.argv[1]`
   * ending in `cli/index.js`, which is false once npm installs the package — argv[1] is then the
   * `node_modules/.bin/archcheck` symlink. The CLI did nothing and exited 0, so a consumer read
   * "clean" from a check that never ran.
   *
   * It has to be NODE against the BUILT dist through a symlink, which is what npm sets up. Running
   * the source through Bun does not reproduce it: Bun resolves a symlink to its realpath, so
   * argv[1] ends in `cli/index.ts` after all and the guard passes. That near-miss is the reason
   * this test is spelled out rather than simplified.
   */
  const DIST_CLI = join(ROOT, 'dist', 'cli', 'index.js');

  function node(entry: string, args: string[], cwd: string) {
    try {
      const stdout = execFileSync('node', [entry, ...args], {
        cwd,
        encoding: 'utf8',
        env: childEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout };
    } catch (error) {
      const e = error as { status?: number; code?: string; message?: string; stdout?: string };
      // No numeric status means the process never started — reporting that as exit 1 would forge
      // archcheck's "new violations" code and throw the reason away.
      if (typeof e.status !== 'number') {
        throw new Error(
          `could not start \`node ${entry}\` in ${cwd}: ${e.code ?? ''} ${e.message ?? ''}`.trim(),
        );
      }
      return { code: e.status, stdout: e.stdout ?? '' };
    }
  }

  test('node runs it through a differently-named symlink, and still reports', () => {
    if (!existsSync(DIST_CLI)) {
      execFileSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' });
    }
    const work = mkdtempSync(join(tmpdir(), 'archcheck-bin-'));
    try {
      // The shape npm creates: node_modules/.bin/archcheck -> ../archcheck/dist/cli/index.js
      const link = join(work, 'archcheck');
      symlinkSync(DIST_CLI, link);

      const clean = node(link, [], fixture('clean'));
      expect(clean.stdout).toContain('nothing to fix');
      expect(clean.code).toBe(0);

      // And it must still FAIL through that path: a silent exit 0 is indistinguishable from clean,
      // which is precisely how the original bug hid.
      const dirty = node(link, [], fixture('layered'));
      expect(dirty.stdout).toContain('domain may not import service');
      expect(dirty.code).toBe(1);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    // Its own timeout, above the 30s default set in scripts/check-tests.sh: this is the only test
    // that may run a full `tsc` build (the on-demand `bun run build` above, for a fresh clone with
    // no dist/) before it does its own work. CI builds dist/ first, so that branch is local-only.
  }, 60000);

  /**
   * The regression test for truncated piped output. The entry point called `process.exit(code)`
   * as soon as `main` resolved, and Node writes to a PIPE asynchronously: whatever was still
   * queued past the first 64 KiB was discarded. A redirect to a file was complete, so the bug hid
   * from a person and landed on the agent reading `--format json | …`, which got invalid JSON.
   *
   * Same constraints as the test above: node and the built dist. And stdout must be a real shell
   * pipe: through Bun's `execFileSync` the child's stdout is not one that reproduces it, and this
   * test passed against the broken entry point until it was routed through bash. `PIPESTATUS`
   * keeps node's exit code rather than `cat`'s. Node writes pipes synchronously on Linux, so on a
   * Linux runner this passes either way; it is macOS, where agents run it locally, that it guards.
   */
  test('output larger than one pipe buffer arrives whole through a pipe', () => {
    if (!existsSync(DIST_CLI)) {
      execFileSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' });
    }
    inCopyOf('layered', (root) => {
      // Each file is one more domain → service violation, so the report grows well past 64 KiB.
      for (let index = 0; index < 400; index++) {
        writeFileSync(
          join(root, 'modules', 'ledger', 'domain', `reach${index}.ts`),
          `import { writeEntry } from '../services/write.js';\nexport const reach${index} = writeEntry;\n`,
        );
      }
      const piped = spawnSync(
        'bash',
        ['-c', 'node "$0" --format json | cat; exit "$PIPESTATUS"', DIST_CLI],
        { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      );
      if (piped.error) throw piped.error;
      // The length an unbroken writer produces, computed from what was received: if the pipe cut
      // the output short, JSON.parse throws before this comparison is reached.
      const parsed = JSON.parse(piped.stdout);
      expect(piped.stdout.length).toBeGreaterThan(64 * 1024);
      expect(piped.stdout).toBe(`${JSON.stringify(parsed)}\n`);
      expect(parsed.diagnostics.length).toBeGreaterThanOrEqual(400);
      // The frozen exit code survives the change in how the process ends.
      expect(piped.status).toBe(1);
    });
  }, 60000);
});

describe('SARIF and coverage, end to end (plans 18-19)', () => {
  test('--format sarif emits a 2.1.0 document with our extras in properties', () => {
    const { stdout, code } = archcheck(['--cwd', fixture('layered'), '--format', 'sarif']);
    expect(code).toBe(1);
    const sarif = JSON.parse(stdout);
    expect(sarif.version).toBe('2.1.0');
    const run = sarif.runs[0];
    expect(run.tool.driver.name).toBe('archcheck');
    expect(run.results).toHaveLength(2);
    expect(run.results[0].properties.identity).toHaveLength(16);
    expect(run.results[0].partialFingerprints.archcheckIdentity).toHaveLength(16);
    // Every ruleId is declared, or an editor viewer shows a result with no rule behind it.
    const declared = new Set(run.tool.driver.rules.map((r: { id: string }) => r.id));
    for (const result of run.results) expect(declared.has(result.ruleId)).toBe(true);
  });

  test('a baselined finding appears in SARIF as suppressed, not as absent', () => {
    inCopyOf('layered', (root) => {
      archcheck(['baseline', '--write'], root);
      const sarif = JSON.parse(archcheck(['--format', 'sarif'], root).stdout);
      const results = sarif.runs[0].results;
      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result.suppressions[0].justification).toContain('.archcheck/baseline.json');
      }
    });
  });

  test('coverage prints the computed counts and percentage', () => {
    const { stdout, code } = archcheck(['coverage', '--cwd', fixture('layered')]);
    expect(code).toBe(0);
    expect(stdout).toContain('✓ 5 deterministic');
    expect(stdout).toContain('5 rules total · 100% automatable');
  });

  test('adding a judgement rule moves the percentage down', () => {
    inCopyOf('layered', (root) => {
      const config = join(root, 'architecture.config.ts');
      writeFileSync(
        config,
        readFileSync(config, 'utf8').replace(
          '  ],\n});',
          `    {
      id: 'controllers-stay-thin',
      kind: 'judgement' as const,
      statement: 'a controller decides nothing',
      severity: 'advisory' as const,
      confidence: 'model' as const,
      params: {
        statement: 'A controller must not decide a business outcome.',
        appliesTo: 'modules/**',
        examples: { pass: ['return decide(x);'], fail: ['if (a > b) return "no";'] },
        cite: 'the deciding branch',
      },
      remedy: { summary: 'move the branch into the domain' },
    },
  ],
});`,
        ),
      );
      const { stdout } = archcheck(['coverage'], root);
      expect(stdout).toContain('○ 1 judgement');
      expect(stdout).toContain('6 rules total · 83% automatable');
    });
  });

  test('rules.json is emitted as data, schema-versioned and sorted', () => {
    inCopyOf('layered', (root) => {
      archcheck(['emit'], root);
      const rules = JSON.parse(readFileSync(join(root, 'generated', 'rules.json'), 'utf8'));
      expect(rules.schemaVersion).toBe(1);
      expect(rules.coverage.automatable).toBe(100);
      expect(rules.rules.map((r: { id: string }) => r.id)).toEqual([
        'contracts-import-nothing',
        'domain-no-service-import',
        'repositories-reach-contracts-only',
        'rules-are-pure',
        'services-orchestrate-only',
      ]);
    });
  });

  test('two consecutive emits produce identical output', () => {
    inCopyOf('layered', (root) => {
      archcheck(['emit'], root);
      const first = readFileSync(join(root, 'generated', 'rules.json'), 'utf8');
      archcheck(['emit'], root);
      expect(readFileSync(join(root, 'generated', 'rules.json'), 'utf8')).toBe(first);
      expect(archcheck(['emit', '--check'], root).code).toBe(0);
    });
  });
});

describe('the fenced document region (plan 19)', () => {
  test('is replaced on emit, and a hand-edit inside it exits 3', () => {
    inCopyOf('layered', (root) => {
      const doc = join(root, 'PATTERNS.md');
      writeFileSync(
        doc,
        '# Patterns\n\nHand-written prose that must survive.\n\n<!-- archcheck:begin rules-table -->\n<!-- archcheck:end rules-table -->\n\nMore prose.\n',
      );
      const config = join(root, 'architecture.config.ts');
      writeFileSync(
        config,
        readFileSync(config, 'utf8').replace(
          'export default defineArchitecture({',
          "export default defineArchitecture({\n  docs: ['PATTERNS.md'],",
        ),
      );

      expect(archcheck(['emit'], root).code).toBe(0);
      const generated = readFileSync(doc, 'utf8');
      expect(generated).toContain('Hand-written prose that must survive.');
      expect(generated).toContain('More prose.');
      expect(generated).toContain('| ✓ | `domain-no-service-import` |');
      expect(archcheck(['emit', '--check'], root).code).toBe(0);

      writeFileSync(doc, generated.replace('`domain-no-service-import`', '`someone-typed-here`'));
      const stale = archcheck(['emit', '--check'], root);
      expect(stale.code).toBe(3);
      expect(stale.stderr).toContain('PATTERNS.md');
    });
  });

  test('a declared document that is not there is reported, never quietly dropped', () => {
    inCopyOf('layered', (root) => {
      const config = join(root, 'architecture.config.ts');
      writeFileSync(
        config,
        readFileSync(config, 'utf8').replace(
          'export default defineArchitecture({',
          "export default defineArchitecture({\n  docs: ['PATTERNS.md'],",
        ),
      );
      // No PATTERNS.md on disk. `planEmit` used to drop it from the plan, so `emit --check`
      // never compared it and answered "emitted output is up to date".
      expect(archcheck(['emit'], root).code).toBe(0);

      const { code, stderr, stdout } = archcheck(['emit', '--check'], root);
      expect(code).toBe(3);
      expect(stderr).toContain('PATTERNS.md');
      expect(stdout).not.toContain('up to date');
      // Re-emitting cannot create a document nobody wrote, so it is not offered as the fix.
      expect(stderr).not.toContain('run: npx archcheck emit');
    });
  });
});
