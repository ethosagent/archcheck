/**
 * Finding, compiling and evaluating `architecture.config.ts`.
 *
 * What this is for: the manifest is TypeScript, so it has to be compiled to be read. It is
 * compiled with the consumer's own `typescript` (our single peer dependency) — no bundler, no
 * ts-node, and no temporary file on disk, because a tool that scatters temp files into a repo it
 * is auditing has already lost the argument.
 *
 * How: transpile to CommonJS in memory, then evaluate the result with an injected `require`. The
 * one specifier a manifest actually needs at run time is `archcheck` itself, and that resolves to
 * a value we already hold — so the common case needs no module resolution at all, and works
 * identically under Node and Bun. Anything else the manifest imports goes through Node's own
 * resolver, rooted at the config file.
 *
 * What a caller must know: this executes the config. That is what a config file is for, and it is
 * the operator's own committed code — but it does mean `load()` is not a safe place to point at an
 * untrusted file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { err, ok, type Result } from '../result.js';
import { type ArchitectureManifest, defineArchitecture } from './define.js';

export const CONFIG_FILENAME = 'architecture.config.ts';

/** Walk up from `start` looking for the manifest. Returns its absolute path, or null. */
export function findConfig(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The module we hand back for `import ... from 'archcheck'`, without resolving anything. */
function archcheckModule(): Record<string, unknown> {
  return { defineArchitecture, default: { defineArchitecture } };
}

function isArchcheckSpecifier(specifier: string): boolean {
  if (specifier === 'archcheck' || specifier.startsWith('archcheck/')) return true;
  // archcheck's own manifest reaches its source directly; treat that as the same module.
  return /(^|\/)src\/index(\.[jt]s)?$/.test(specifier) || /(^|\/)dist\/index\.js$/.test(specifier);
}

export type LoadedManifest = {
  manifest: ArchitectureManifest;
  configPath: string;
  /** Absolute, and the base every relative path in the manifest resolves against. */
  root: string;
};

export function loadManifestFrom(configPath: string): Result<LoadedManifest> {
  let source: string;
  try {
    source = readFileSync(configPath, 'utf8');
  } catch (error) {
    return err([`cannot read ${configPath}: ${(error as Error).message}`]);
  }

  const transpiled = ts.transpileModule(source, {
    fileName: configPath,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: true,
    },
  });

  const syntaxErrors = (transpiled.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (syntaxErrors.length > 0) {
    return err(
      syntaxErrors.map(
        (d) => `${CONFIG_FILENAME}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
      ),
    );
  }

  const nodeRequire = createRequire(configPath);
  const requireShim = (specifier: string): unknown =>
    isArchcheckSpecifier(specifier) ? archcheckModule() : nodeRequire(specifier);

  const moduleShim: { exports: Record<string, unknown> } = { exports: {} };
  try {
    // `new Function` rather than `eval`: the config body gets its own scope with exactly the five
    // CommonJS bindings it expects and nothing of ours. Compiling the operator's own committed
    // config is the job of this module, not an escape hatch.
    const evaluate = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      transpiled.outputText,
    );
    evaluate(moduleShim.exports, requireShim, moduleShim, configPath, dirname(configPath));
  } catch (error) {
    return err([`${CONFIG_FILENAME} threw while loading: ${(error as Error).message}`]);
  }

  const exported = moduleShim.exports.default ?? moduleShim.exports;
  if (typeof exported !== 'object' || exported === null) {
    return err([
      `${CONFIG_FILENAME} must export a default: export default defineArchitecture({ rules: [...] })`,
    ]);
  }

  const manifest = exported as ArchitectureManifest;
  const root = manifest.root ? resolve(dirname(configPath), manifest.root) : dirname(configPath);
  return ok({ manifest, configPath, root });
}

export function loadManifest(startDir: string): Result<LoadedManifest> {
  const configPath = findConfig(startDir);
  if (configPath === null) {
    return err([
      `no ${CONFIG_FILENAME} found in ${resolve(startDir)} or any parent directory`,
      '  → create one: export default defineArchitecture({ rules: [] })',
    ]);
  }
  return loadManifestFrom(configPath);
}
