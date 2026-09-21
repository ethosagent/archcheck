/**
 * The reporter registry. A new audience is one entry here and nothing else.
 */
import { createJsonReporter } from './json.js';
import { createTerminalReporter } from './terminal.js';
import type { Reporter } from './types.js';
import { createVerdictReporter } from './verdict.js';

export type ReporterName = 'terminal' | 'json' | 'json-pretty' | 'verdict';

export function reporterFor(name: ReporterName): Reporter {
  switch (name) {
    case 'json':
      return createJsonReporter();
    case 'json-pretty':
      return createJsonReporter({ pretty: true });
    case 'verdict':
      return createVerdictReporter();
    case 'terminal':
      return createTerminalReporter();
  }
}

export function reporterNames(): readonly ReporterName[] {
  return ['terminal', 'json', 'json-pretty', 'verdict'];
}

export { createJsonReporter, type JsonReport, toJsonReport } from './json.js';
export { createTerminalReporter } from './terminal.js';
export { CONFIDENCE_ORDER, type ReportCtx, type Reporter, visible } from './types.js';
export { createVerdictReporter, type Verdict, verdictFor } from './verdict.js';
