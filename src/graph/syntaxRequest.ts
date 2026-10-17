/**
 * Syntax request vocabulary for the graph layer.
 * A caller must know that a request names a construct and optional target,
 * carrying no rule id or severity so facts remain reusable across rules.
 */

export type SyntaxConstruct =
  | 'member-access'
  | 'new-expression'
  | 'call'
  | 'reference'
  | 'string-literal'
  | 'string-literal-comparison'
  | 'empty-catch'
  | 'suppression-comment'
  | 'module-mutable-state'
  | 'declared-field-call';

export type SyntaxRequest = {
  construct: SyntaxConstruct;
  target?: string;
};

export const REQUEST_SEPARATOR = ' ';

export function requestKey(request: SyntaxRequest): string {
  if (request.target === undefined) return request.construct;
  return request.construct + REQUEST_SEPARATOR + request.target;
}

export function dedupeRequests(requests: readonly SyntaxRequest[]): SyntaxRequest[] {
  const seen = new Set<string>();
  const result: SyntaxRequest[] = [];
  for (const request of requests) {
    const key = requestKey(request);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(request);
  }
  return result;
}

export function requestsFingerprint(requests: readonly SyntaxRequest[]): string {
  const keys = new Set<string>();
  for (const request of requests) keys.add(requestKey(request));
  return [...keys].sort().join('\n');
}
