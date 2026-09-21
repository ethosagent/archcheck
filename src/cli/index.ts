#!/usr/bin/env node
import { EXIT, type ExitCode, exitCodeFor, load } from '../archcheck.js';
/**
 * The command surface. Thin by construction: parse args → one ArchCheck method → a reporter.
 *
 * What rule this enforces: this file owns NO behaviour. Every capability is reachable through
 * `ArchCheck`, because the agent hook does not shell out (plan 10). A feature that only works from
 * here would be a feature an agent cannot use.
 *
 * This is an app entry point — the one place allowed to write to the console (PROD-1).
 */
import { describeStale } from '../emit/write.js';
import { reporterFor } from '../report/index.js';
import { gitChangedFiles, HELP, type ParsedArgs, parseArgs } from './args.js';
import { packageVersion } from './version.js';

function fail(lines: readonly string[], code: ExitCode): ExitCode {
  for (const line of lines) console.error(line);
  return code;
}

async function runCheck(args: ParsedArgs, cwd: string): Promise<ExitCode> {
  const loaded = load({ cwd });
  if (!loaded.ok) return fail(loaded.error, EXIT.config);

  const changed = args.changed?.length === 0 ? gitChangedFiles(cwd) : args.changed;
  const result = await loaded.value.check({
    ...(changed === undefined ? {} : { changed }),
    ...(args.only === undefined ? {} : { only: args.only }),
    ingestGraph: args.ingestGraph,
    writeGraph: args.writeGraph,
  });
  if (!result.ok) return fail(result.error, EXIT.config);

  const text = await reporterFor(args.format).report(result.value, {
    showBaselined: args.showBaselined,
    noColor: args.noColor || process.env.NO_COLOR !== undefined || !process.stdout.isTTY,
    root: cwd,
  });
  if (typeof text === 'string') process.stdout.write(text);
  return exitCodeFor(result.value);
}

async function runEmit(args: ParsedArgs, cwd: string): Promise<ExitCode> {
  // `emit` is the command that WRITES the id ledger, so it must be able to run while the ledger
  // and the manifest disagree — otherwise recording a new id would require the record to exist.
  const loaded = load({ cwd, skipIdCheck: args.emitCheck === false });
  if (!loaded.ok) return fail(loaded.error, EXIT.config);

  if (args.emitCheck) {
    const stale = loaded.value.emitCheck();
    if (!stale.ok) return fail(stale.error, EXIT.config);
    if (stale.value.length === 0) {
      console.log('emitted output is up to date');
      return EXIT.clean;
    }
    return fail(
      [
        'emitted output is stale:',
        ...describeStale(stale.value).map((line) => `  ${line}`),
        '  → run: npx archcheck emit',
      ],
      EXIT.stale,
    );
  }

  const emitted = loaded.value.emit();
  if (!emitted.ok) return fail(emitted.error, EXIT.config);
  const changed = emitted.value.written.filter((file) => file.changed);
  if (changed.length === 0) console.log('emitted output already matched the manifest');
  for (const file of changed) console.log(`wrote ${file.path}`);
  console.log(`wrote ${emitted.value.ledgerPath}`);
  return EXIT.clean;
}

async function runExplain(args: ParsedArgs, cwd: string): Promise<ExitCode> {
  const loaded = load({ cwd });
  if (!loaded.ok) return fail(loaded.error, EXIT.config);
  const explained = await loaded.value.explain(args.ruleId ?? '');
  if (!explained.ok) return fail(explained.error, EXIT.config);
  console.log(explained.value);
  return EXIT.clean;
}

function runCoverage(cwd: string): ExitCode {
  const loaded = load({ cwd });
  if (!loaded.ok) return fail(loaded.error, EXIT.config);
  const { total, deterministic, proxy, model } = loaded.value.coverage();
  const percent = total === 0 ? 0 : Math.round(((deterministic + proxy) / total) * 100);
  console.log(`✓ ${deterministic} deterministic`);
  console.log(`◑ ${proxy} proxy`);
  console.log(`○ ${model} judgement`);
  console.log(`  ${total} rules total · ${percent}% automatable`);
  return EXIT.clean;
}

export async function main(argv: readonly string[]): Promise<ExitCode> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) return fail([...parsed.error, '', 'see archcheck --help'], EXIT.config);
  const args = parsed.value;
  const cwd = args.cwd ?? process.cwd();

  switch (args.command) {
    case 'version':
      console.log(packageVersion());
      return EXIT.clean;
    case 'help':
      console.log(HELP);
      return EXIT.clean;
    case 'emit':
      return runEmit(args, cwd);
    case 'explain':
      return runExplain(args, cwd);
    case 'coverage':
      return runCoverage(cwd);
    case 'check':
      return runCheck(args, cwd);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('cli/index.ts') || process.argv[1].endsWith('cli/index.js'));

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(EXIT.config);
    });
}
