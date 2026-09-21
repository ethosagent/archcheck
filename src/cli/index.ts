#!/usr/bin/env node
/**
 * The command surface. Thin by construction: parse args → one ArchCheck method → a reporter.
 *
 * What rule this enforces: this file owns NO behaviour. Every capability is reachable through
 * `ArchCheck`, because the agent hook does not shell out (plan 10). A feature that only works from
 * here would be a feature an agent cannot use.
 *
 * This is an app entry point — the one place allowed to write to the console (PROD-1).
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildInitManifest,
  CONFIG_FILENAME,
  EXIT,
  type ExitCode,
  exitCodeFor,
  initSummary,
  load,
} from '../archcheck.js';
import { automatablePercent, MARK } from '../coverage/index.js';
import { describeUnimplemented } from '../emit/index.js';
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

  // Load-time warnings first: a judgement rule promoted to `error` is legal, and it must not be
  // possible to promote one quietly.
  for (const warning of loaded.value.registry.warnings()) console.error(`warning: ${warning}`);

  // `--changed` with no value means "ask git". A git that cannot answer is a failure, never an
  // empty changed set: every probe would filter to nothing and the run would read as clean
  // (gitChangedFiles, src/cli/args.ts).
  let changed = args.changed;
  if (args.changed?.length === 0) {
    const asked = gitChangedFiles(cwd);
    if (!asked.ok) return fail(asked.error, EXIT.config);
    changed = asked.value;
  }
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

  // Skipping the immutability check is not the same as accepting a ledger nobody could read:
  // `emit` WRITES the ledger, so it would replace it with one rebuilt from today's manifest and
  // every retired id would vanish. `readIdLedger` (src/registry/ids.ts) marks it.
  const ledger = loaded.value.registry.ledger();
  if (ledger.unreadable !== undefined) return fail([ledger.unreadable], EXIT.config);

  // A kind no contract type implements generates nothing. `emit` has no `skipped` channel, so
  // this is the one place it is said — on both the write and the --check path.
  for (const line of describeUnimplemented(loaded.value.registry.all())) console.error(line);

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
        // `unreadable` is the one reason re-emitting cannot fix — the document `docs` names is not
        // there — so an agent is not sent round a loop that changes nothing.
        ...(stale.value.some((file) => file.reason !== 'unreadable')
          ? ['  → run: npx archcheck emit']
          : []),
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

function runInit(args: ParsedArgs, cwd: string): ExitCode {
  const configPath = join(cwd, CONFIG_FILENAME);
  if (existsSync(configPath) && !args.force) {
    return fail(
      [
        `${CONFIG_FILENAME} already exists — archcheck init will not overwrite your manifest`,
        '  → pass --force if you really mean to replace it',
      ],
      EXIT.config,
    );
  }

  const built = buildInitManifest(cwd, join(cwd, 'tsconfig.json'));
  if (!built.ok) return fail(built.error, EXIT.config);

  writeFileSync(configPath, built.value.manifest);
  for (const line of initSummary(cwd, built.value.layers)) console.log(line);
  console.log('');

  if (!built.value.observed) {
    // Never silent. Without the graph every allow-list is empty, so the manifest names the layers
    // and describes nothing about how they depend on each other.
    for (const line of built.value.notObservedBecause ?? []) console.error(`warning: ${line}`);
    console.error('');
    console.error(
      `wrote ${CONFIG_FILENAME}, but archcheck could not read your module graph, so every ` +
        'mayImport list is EMPTY.',
    );
    console.error('  → fix the problem above, delete the file, and run `archcheck init --force`');
    return EXIT.config;
  }

  console.log(`wrote ${CONFIG_FILENAME} — every rule is 'warn', so the first run is green`);
  console.log('  next: npx archcheck          see what it observes');
  console.log('        npx archcheck emit     write the generated configs');
  return EXIT.clean;
}

async function runBaseline(args: ParsedArgs, cwd: string): Promise<ExitCode> {
  const loaded = load({ cwd });
  if (!loaded.ok) return fail(loaded.error, EXIT.config);
  const outcome = await loaded.value.baseline(args.baselineMode ?? 'write');
  if (!outcome.ok) return fail(outcome.error, EXIT.config);
  const { path, entries, removed } = outcome.value;
  console.log(
    args.baselineMode === 'prune'
      ? `pruned ${removed} entr${removed === 1 ? 'y' : 'ies'} — ${entries} remaining in ${path}`
      : `recorded ${entries} entr${entries === 1 ? 'y' : 'ies'} in ${path}`,
  );
  if (args.baselineMode === 'write' && entries > 0) {
    console.log('  these are debt, not policy: no owner and no expiry, so they stay visible');
  }
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
  const coverage = loaded.value.coverage();
  const { total, deterministic, proxy, model, unchecked } = coverage;
  console.log(`${MARK.deterministic} ${deterministic} deterministic`);
  console.log(`${MARK.proxy} ${proxy} proxy`);
  console.log(`${MARK.model} ${model} judgement`);
  if (unchecked > 0) {
    console.log(`  ${unchecked} declared, but no version of archcheck checks their kind yet`);
  }
  console.log(`  ${total} rules total · ${automatablePercent(coverage)}% automatable`);
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
    case 'baseline':
      return runBaseline(args, cwd);
    case 'init':
      return runInit(args, cwd);
    case 'check':
      return runCheck(args, cwd);
  }
}

// This module IS the bin, and nothing imports it, so it runs unconditionally. It previously
// guarded on `process.argv[1]` ending in `cli/index.js` — which is false when npm installs the
// package, because argv[1] is then the `node_modules/.bin/archcheck` symlink. The CLI silently
// did nothing and exited 0, so a consumer read "clean" from a check that never ran. A guard that
// can be wrong about whether to run at all has no place in an entry point.
main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(EXIT.config);
  });
