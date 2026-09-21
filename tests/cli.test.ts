/**
 * The CLI, end to end, as an agent actually meets it: a subprocess and an exit code.
 *
 * Exit codes are an API — an agent branches on them — so there is one test per code, driven
 * through the real binary rather than through the facade.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLI = join(ROOT, 'src', 'cli', 'index.ts');
const fixture = (name: string) => join(ROOT, 'fixtures', 'repos', name);

function archcheck(args: string[], cwd = ROOT): { code: number; stdout: string; stderr: string } {
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
    expect(stderr).toContain('--format expects one of terminal, json, json-pretty, verdict');
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

describe('--format routes to the right reporter', () => {
  test('json is one line, schema-versioned, and always carries skipped', () => {
    const { stdout } = archcheck(['--cwd', fixture('layered'), '--format', 'json']);
    expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.diagnostics).toHaveLength(2);
    expect(parsed.coverage).toEqual({ total: 5, deterministic: 5, proxy: 0, model: 0 });
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
      params: { statement: 'no business branch', appliesTo: 'modules/**' },
      remedy: { summary: 'move the branch into the domain' },
    },
  ],
});`,
        )}`,
      );

      const all = JSON.parse(archcheck(['--cwd', root, '--format', 'json']).stdout);
      expect(all.coverage.model).toBe(1);
      // No probe handles judgement in this version, and the run says so rather than implying clean.
      expect(all.skipped).toEqual([
        { probe: 'judgement rules', reason: 'no probe in this version handles this kind' },
      ]);

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
