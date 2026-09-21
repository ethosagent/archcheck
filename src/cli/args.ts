/**
 * Argument parsing, and nothing else.
 *
 * What a caller must know: this returns a Result too. An unknown flag is a CONFIG-class mistake —
 * exit 2, not 1 — because an agent that typed the wrong flag must not read "no violations" as
 * success.
 */
import { execFileSync } from 'node:child_process';
import type { ReporterName } from '../report/index.js';
import { err, ok, type Result } from '../result.js';
import type { Confidence } from '../types.js';

export type Command =
  | 'check'
  | 'emit'
  | 'explain'
  | 'coverage'
  | 'baseline'
  | 'init'
  | 'version'
  | 'help';

export type ParsedArgs = {
  command: Command;
  format: ReporterName;
  only?: Confidence;
  /** `--changed` with no value means "ask git". */
  changed?: readonly string[];
  emitCheck: boolean;
  /** `init --force`: overwrite an existing manifest. */
  force: boolean;
  /** `baseline --write` or `baseline --prune`. */
  baselineMode?: 'write' | 'prune';
  showBaselined: boolean;
  ingestGraph: boolean;
  writeGraph: boolean;
  noColor: boolean;
  ruleId?: string;
  cwd?: string;
};

const FORMATS: Record<string, ReporterName> = {
  terminal: 'terminal',
  json: 'json',
  'json-pretty': 'json-pretty',
  sarif: 'sarif',
  verdict: 'verdict',
};

const TIERS: Record<string, Confidence> = {
  deterministic: 'deterministic',
  proxy: 'proxy',
  model: 'model',
};

export const HELP = `archcheck — architecture conformance, declared once and checked everywhere

  archcheck                      run every rule, terminal output
  archcheck --changed            diff-scoped · the pre-commit path
  archcheck --format json        the agent format
  archcheck --format sarif       SARIF 2.1.0, for CI code scanning and editors
  archcheck --format verdict     one blocking answer, for a hook
  archcheck --only deterministic skip the proxy and model tiers
  archcheck --show-baselined     include findings the baseline records
  archcheck --write-graph        write .archcheck/graph.json for later gates to ingest
  archcheck --ingest-graph       read .archcheck/graph.json instead of re-reading the graph

  archcheck emit                 regenerate the emitted configs
  archcheck emit --check         fail if the committed output is stale
  archcheck explain <ruleId>     statement, remedy and current violations
  archcheck coverage             the three counts, computed from the manifest
  archcheck baseline --write     record today's violations as pre-existing debt
  archcheck baseline --prune     drop entries that no longer reproduce
  archcheck init                 write a starting architecture.config.ts from the folders
  archcheck --version

exit codes
  0  clean, or only baselined and advisory findings
  1  new violations of error-severity rules      → fix the code
  2  configuration invalid                       → fix the manifest, not the code
  3  emitted output is stale                     → run archcheck emit
  4  a baselined finding no longer reproduces    → run archcheck baseline --prune
`;

/**
 * Ask git for the changed set. Local only — archcheck makes no network call it was not told to.
 *
 * A git that cannot answer is a CONFIG failure (exit 2), never an empty changed set. git missing
 * from PATH, an unborn or detached HEAD, or a directory outside any work tree used to be swallowed
 * by a bare catch returning `[]`: every probe then filtered to nothing and the run reported clean,
 * so a pre-commit hook passed every commit forever. Exit 2 because the manifest and the code are
 * both fine — the environment is not, which is the same call `init` makes when it cannot read the
 * module graph. `tests/cli.test.ts` → '--changed > git failing is a config error (2)' pins it.
 */
export function gitChangedFiles(cwd: string): Result<readonly string[]> {
  const files = new Set<string>();
  for (const args of [
    ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'],
    ['diff', '--name-only', '--diff-filter=ACMR', '--cached'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    let output: string;
    try {
      output = execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const said = (error as { stderr?: string }).stderr;
      const detail = said === undefined || said.trim() === '' ? describeError(error) : said.trim();
      return err([
        `--changed asked git for the changed set, and \`git ${args.join(' ')}\` failed:`,
        // git answers a misuse with its whole usage screen. The first two lines carry the reason;
        // the rest would bury the two suggestions below.
        ...detail
          .split('\n')
          .filter((line) => line.trim() !== '')
          .slice(0, 2)
          .map((line) => `  ${line.trim()}`),
        '  → the environment is wrong, not the code: an empty changed set would check nothing',
        '  → name the files yourself (--changed a.ts,b.ts), or drop --changed to check everything',
      ]);
    }
    for (const line of output.split('\n')) {
      const file = line.trim();
      if (file.length > 0) files.add(file);
    }
  }
  return ok([...files].sort());
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseArgs(argv: readonly string[]): Result<ParsedArgs> {
  const parsed: ParsedArgs = {
    command: 'check',
    format: 'terminal',
    emitCheck: false,
    force: false,
    showBaselined: false,
    ingestGraph: false,
    writeGraph: false,
    noColor: false,
  };
  const errors: string[] = [];
  const rest = [...argv];
  let sawCommand = false;

  // The subcommand is recognised WHEREVER it appears, not only at argv[0]. `--cwd x baseline
  // --write` is a perfectly natural thing to type, and a parser that silently rejected it read
  // as "unexpected argument 'baseline'" — which names the wrong thing.
  const COMMANDS = new Set(['check', 'emit', 'explain', 'coverage', 'baseline', 'init']);

  while (rest.length > 0) {
    const arg = rest.shift() as string;
    const [flag, inlineValue] =
      arg.startsWith('--') && arg.includes('=')
        ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
        : [arg, undefined];
    const takeValue = (): string | undefined =>
      inlineValue ?? (rest[0]?.startsWith('-') === false ? rest.shift() : undefined);

    switch (flag) {
      case '--version':
      case '-v':
        parsed.command = 'version';
        break;
      case '--help':
      case '-h':
        parsed.command = 'help';
        break;
      case '--format': {
        const value = takeValue();
        const format = value === undefined ? undefined : FORMATS[value];
        if (format === undefined) {
          errors.push(
            `--format expects one of ${Object.keys(FORMATS).join(', ')} (got ${String(value)})`,
          );
        } else {
          parsed.format = format;
        }
        break;
      }
      case '--only': {
        const value = takeValue();
        const tier = value === undefined ? undefined : TIERS[value];
        if (tier === undefined) {
          errors.push(
            `--only expects one of ${Object.keys(TIERS).join(', ')} (got ${String(value)})`,
          );
        } else {
          parsed.only = tier;
        }
        break;
      }
      case '--changed': {
        const value = takeValue();
        parsed.changed =
          value === undefined
            ? []
            : value
                .split(',')
                .map((f) => f.trim())
                .filter(Boolean);
        break;
      }
      case '--check':
        parsed.emitCheck = true;
        break;
      case '--write':
        parsed.baselineMode = 'write';
        break;
      case '--prune':
        parsed.baselineMode = 'prune';
        break;
      case '--force':
        parsed.force = true;
        break;
      case '--show-baselined':
        parsed.showBaselined = true;
        break;
      case '--ingest-graph':
        parsed.ingestGraph = true;
        break;
      case '--write-graph':
        parsed.writeGraph = true;
        break;
      case '--no-color':
        parsed.noColor = true;
        break;
      case '--cwd': {
        const value = takeValue();
        if (value === undefined) errors.push('--cwd expects a directory');
        else parsed.cwd = value;
        break;
      }
      default:
        if (flag.startsWith('-')) errors.push(`unknown flag '${flag}' — see archcheck --help`);
        else if (COMMANDS.has(flag) && !sawCommand) {
          parsed.command = flag as Command;
          sawCommand = true;
        } else if (parsed.command === 'explain' && parsed.ruleId === undefined)
          parsed.ruleId = flag;
        else errors.push(`unexpected argument '${flag}'`);
    }
  }

  if (parsed.command === 'explain' && parsed.ruleId === undefined) {
    errors.push('explain needs a rule id: archcheck explain <ruleId>');
  }
  if (parsed.emitCheck && parsed.command !== 'emit') {
    errors.push('--check applies to `archcheck emit` only');
  }
  if (parsed.baselineMode !== undefined && parsed.command !== 'baseline') {
    errors.push('--write and --prune apply to `archcheck baseline` only');
  }
  if (parsed.force && parsed.command !== 'init') {
    errors.push('--force applies to `archcheck init` only');
  }
  if (parsed.command === 'baseline' && parsed.baselineMode === undefined) {
    errors.push(
      "baseline needs a mode: --write to record today's violations, --prune to drop what no longer reproduces",
    );
  }
  if (parsed.writeGraph && parsed.ingestGraph) {
    errors.push(
      '--write-graph and --ingest-graph are mutually exclusive: one produces the report the other consumes',
    );
  }

  return errors.length > 0 ? err(errors) : ok(parsed);
}
