#!/usr/bin/env node
/**
 * The command surface. Thin by construction: parse args → an ArchCheck method → a reporter.
 * Every behaviour is reachable programmatically, because the agent hook does not shell out
 * (plan 10).
 */
import { packageVersion } from './version.js';

async function main(argv: string[]): Promise<number> {
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(packageVersion());
    return 0;
  }
  console.log(`archcheck ${packageVersion()}`);
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
