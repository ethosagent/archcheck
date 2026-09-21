/**
 * Building the `Program` from the consumer's own tsconfig.
 *
 * Why the compiler API directly rather than a wrapper: it is one peer dependency we already
 * require, there is no second abstraction to learn, and we get the type checker — which is what
 * `match: { implements }` needs and what no graph tool can offer (plan 04).
 *
 * What a caller must know: a tsconfig problem is a CONFIG failure, not a code failure. It comes
 * back as a Result so the CLI can exit 2 rather than 1 and an agent does not go editing source.
 */
import { dirname } from 'node:path';
import ts from 'typescript';
import { err, ok, type Result } from '../result.js';
import { toPosix } from '../util/paths.js';

export type BuiltProgram = {
  program: ts.Program;
  checker: ts.TypeChecker;
  options: ts.CompilerOptions;
  tsconfigPath: string;
  /** Hash of the resolved compiler options — half of the cache key. */
  optionsFingerprint: string;
};

function fingerprint(options: ts.CompilerOptions, fileCount: number): string {
  const stable = Object.keys(options)
    .sort()
    .map((key) => `${key}=${String((options as Record<string, unknown>)[key])}`)
    .join(';');
  return `${stable}|files=${fileCount}`;
}

export function buildProgram(tsconfigPath: string): Result<BuiltProgram> {
  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (read.error) {
    return err([
      `${toPosix(tsconfigPath)}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`,
    ]);
  }

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfigPath));
  if (parsed.errors.length > 0) {
    return err(
      parsed.errors.map(
        (d) => `${toPosix(tsconfigPath)}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
      ),
    );
  }
  if (parsed.fileNames.length === 0) {
    return err([
      `${toPosix(tsconfigPath)} matches no files — archcheck has nothing to read`,
      '  → check its include/exclude patterns',
    ]);
  }

  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  return ok({
    program,
    checker: program.getTypeChecker(),
    options: parsed.options,
    tsconfigPath,
    optionsFingerprint: fingerprint(parsed.options, parsed.fileNames.length),
  });
}
