import { matches } from '../util/glob.js';

export type SiblingPolicy = 'allow' | 'deny';

export type SiblingVerdict = { denied: false } | { denied: true; fromUnit: string; toUnit: string };

export function unitOf(unit: string, relativePath: string): string | undefined {
  const segments = relativePath.split('/');
  for (let i = 1; i < segments.length; i++) {
    const prefix = segments.slice(0, i).join('/');
    if (matches(unit, prefix)) {
      return prefix;
    }
  }
  return undefined;
}

export function resolveSiblingEdge(
  unit: string,
  policy: SiblingPolicy,
  fromPath: string,
  toPath: string,
): SiblingVerdict {
  if (policy === 'allow') {
    return { denied: false };
  }

  const fromUnit = unitOf(unit, fromPath);
  if (fromUnit === undefined) {
    return { denied: false };
  }

  const toUnit = unitOf(unit, toPath);
  if (toUnit === undefined) {
    return { denied: false };
  }

  if (fromUnit === toUnit) {
    return { denied: false };
  }

  return { denied: true, fromUnit, toUnit };
}
