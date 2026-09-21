/**
 * One guard for "is the TypeScript compiler API actually here?".
 *
 * Why this exists: archcheck reads the compiler API that TypeScript 5.x exposes from its package
 * root — `ts.sys`, `ts.createProgram`, `ts.transpileModule`. TypeScript 7 is the native port, and
 * its root entry exports only `version`; the compiler API moved to a different subpath with a
 * different shape. A consumer who installs `typescript@7` therefore gets an archcheck that fails
 * with `Cannot read properties of undefined (reading 'readFile')`, which names nothing useful.
 *
 * The peer range now excludes 7, so npm warns at install time. This is the second half: a clear
 * message at run time, because a peer warning is easy to miss and a lockfile can carry anything.
 */
const REQUIRED = ['sys', 'createProgram', 'transpileModule', 'readConfigFile'] as const;

export function missingCompilerApi(compiler: unknown): string[] | undefined {
  const api = compiler as Record<string, unknown> | undefined;
  const absent = REQUIRED.filter((name) => api?.[name] === undefined);
  if (absent.length === 0) return undefined;

  const version = typeof api?.version === 'string' ? api.version : 'unknown';
  return [
    `the installed typescript (${version}) does not expose the compiler API archcheck reads`,
    `  missing: ${absent.join(', ')}`,
    '  archcheck needs typescript >=5.4 and <7. TypeScript 7 is the native port, and it exposes',
    '  a different API from a different subpath.',
    '  → install a 6.x or 5.x release: npm install -D typescript@^5.9',
  ];
}
