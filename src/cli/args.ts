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

export type Command = 'check' | 'emit' | 'explain' | 'coverage' | 'baseline' | 'version' | 'help';

export type ParsedArgs = {
  command: Command;
  format: ReporterName;
  only?: Confidence;
  /** `--changed` with no value means "ask git". */
  changed?: readonly string[];
  emitCheck: boolean;
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
  archcheck --version

exit codes
  0  clean, or only baselined and advisory findings
  1  new violations of error-severity rules      → fix the code
  2  configuration invalid                       → fix the manifest, not the code
  3  emitted output is stale                     → run archcheck emit
  4  a baselined finding no longer reproduces    → run archcheck baseline --prune
`;

/** Ask git for the changed set. Local only — archcheck makes no network call it was not told to. */
export function gitChangedFiles(cwd: string): readonly string[] {
  const run = (args: string[]): string[] => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  };
  const tracked = run(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']);
  const staged = run(['diff', '--name-only', '--diff-filter=ACMR', '--cached']);
  const untracked = run(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...tracked, ...staged, ...untracked])].sort();
}

export function parseArgs(argv: readonly string[]): Result<ParsedArgs> {
  const parsed: ParsedArgs = {
    command: 'check',
    format: 'terminal',
    emitCheck: false,
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
  const COMMANDS = new Set(['check', 'emit', 'explain', 'coverage', 'baseline']);

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
