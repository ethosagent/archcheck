/**
 * The package version, read from package.json at run time.
 *
 * Why read rather than inline: an inlined version drifts from the manifest the first time
 * someone bumps one and not the other, and `archcheck --version` is the field a bug report
 * quotes. `node:` builtins only — src/ stays Node-compatible.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/cli/ in development, dist/cli/ once built — package.json is two levels up from both.
  for (const candidate of [
    join(here, '..', '..', 'package.json'),
    join(here, '..', 'package.json'),
  ]) {
    try {
      const raw = JSON.parse(readFileSync(candidate, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (raw.name === 'archcheck' && typeof raw.version === 'string') return raw.version;
    } catch {
      // try the next candidate — a missing package.json here is not an error yet
    }
  }
  return '0.0.0-unknown';
}
