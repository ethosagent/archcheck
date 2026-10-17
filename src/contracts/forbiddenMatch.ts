import { matchesAny } from '../util/glob.js';
import { packageMatchesAny } from './packageMatch.js';

// A side of a forbidden rule, matching by layer and/or glob.
export type ForbiddenSide = {
  layer?: string;
  glob?: string | string[];
  except?: string | string[];
};

// A target side, which may also ban by package for external edges.
export type ForbiddenTarget = ForbiddenSide & { package?: string | string[] };

// Facts about an edge used for matching.
export type EdgeFacts = { path: string; layer: string | undefined; external: boolean };

function list(value: string | string[]): readonly string[] {
  return typeof value === 'string' ? [value] : value;
}

// Checks if an edge matches the from-side of a rule.
export function sideMatches(side: ForbiddenSide, edge: EdgeFacts): boolean {
  if (side.except !== undefined && matchesAny(list(side.except), edge.path)) {
    return false;
  }
  if (side.layer !== undefined && side.layer !== edge.layer) {
    return false;
  }
  if (side.glob !== undefined && !matchesAny(list(side.glob), edge.path)) {
    return false;
  }
  return true;
}

// A package ban reads an external edge and a path ban reads an internal one.
export function targetMatches(to: ForbiddenTarget, edge: EdgeFacts): boolean {
  if (edge.external) {
    return to.package !== undefined && packageMatchesAny(list(to.package), edge.path);
  }
  if (to.package !== undefined) {
    return false;
  }
  return sideMatches(to, edge);
}
