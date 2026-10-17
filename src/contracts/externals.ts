import { builtinModules } from 'node:module';
import { packageMatchesAny } from './packageMatch.js';

const BUILTINS = new Set(builtinModules);

// Externals policy configuration.
export type Externals = { allow?: string[]; deny?: string[] };

// Reason why an external is rejected.
export type ExternalReason = 'denied' | 'unlisted' | undefined;

// fs and node:fs are the same module.
export function normalizeSpecifier(specifier: string): string {
  if (specifier.startsWith('node:')) return specifier;
  const head = specifier.split('/')[0] ?? specifier;
  if (BUILTINS.has(head)) return `node:${specifier}`;
  return specifier;
}

// An allow list is default deny.
export function externalReason(externals: Externals, spec: string): ExternalReason {
  const normalized = normalizeSpecifier(spec);
  if (externals.deny !== undefined && packageMatchesAny(externals.deny, normalized)) {
    return 'denied';
  }
  if (externals.allow !== undefined && !packageMatchesAny(externals.allow, normalized)) {
    return 'unlisted';
  }
  return undefined;
}
