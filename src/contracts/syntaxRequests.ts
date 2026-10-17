/**
 * The syntax questions one manifest asks of the graph.
 *
 * What rule this enforces: the graph collects what the rules need and nothing else. An exhaustive
 * collector — every identifier, every string literal, each resolved through the type checker —
 * would be slower than the per-rule walk it replaces and would write a far larger facts cache.
 * Bounding collection by the manifest keeps it small: archcheck's own manifest asks three
 * questions, so one traversal replaces three.
 *
 * What a caller must know: a rule at severity `off` asks nothing. That is not an optimisation. A
 * disabled rule must not hold the cache hostage, because turning one off and on again would
 * otherwise invalidate every file twice.
 */

import { dedupeRequests, type SyntaxRequest } from '../graph/syntaxRequest.js';
import type { Rule } from '../types.js';
import { asBannedSyntaxParams, bannedSyntaxRequest } from './banned-syntax.js';
import { asDeclaredFieldParams, declaredFieldRequest } from './declared-field.js';

export function syntaxRequestsOf(rules: readonly Rule[]): SyntaxRequest[] {
  const requests: SyntaxRequest[] = [];
  for (const rule of rules) {
    if (rule.severity === 'off') continue;
    if (rule.kind === 'banned-syntax') {
      const request = bannedSyntaxRequest(asBannedSyntaxParams(rule));
      if (request !== undefined) requests.push(request);
    } else if (rule.kind === 'declared-field') {
      requests.push(declaredFieldRequest(asDeclaredFieldParams(rule)));
    }
  }
  return dedupeRequests(requests);
}
