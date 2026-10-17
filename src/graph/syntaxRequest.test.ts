import { describe, expect, test } from 'bun:test';
import {
  dedupeRequests,
  requestKey,
  requestsFingerprint,
  type SyntaxRequest,
} from './syntaxRequest.js';

describe('requestKey', () => {
  const keys: [SyntaxRequest, string][] = [
    [{ construct: 'empty-catch' }, 'empty-catch'],
    [{ construct: 'call', target: 'fetch' }, 'call fetch'],
    [{ construct: 'call', target: '' }, 'call '],
  ];

  test('a request keys as its construct and its target', () => {
    for (const [request, expected] of keys) {
      expect(requestKey(request)).toBe(expected);
    }
  });

  test('two different questions never share a key', () => {
    const four: SyntaxRequest[] = [
      { construct: 'call', target: 'a' },
      { construct: 'call', target: 'b' },
      { construct: 'reference', target: 'a' },
      { construct: 'call' },
    ];

    const unique = new Set(four.map(requestKey));

    expect(unique.size).toBe(4);
  });
});

describe('dedupeRequests', () => {
  test('the first of each repeat survives, in the order given', () => {
    const given: SyntaxRequest[] = [
      { construct: 'call', target: 'fetch' },
      { construct: 'empty-catch' },
      { construct: 'call', target: 'fetch' },
      { construct: 'call' },
    ];

    const survivors: SyntaxRequest[] = [
      { construct: 'call', target: 'fetch' },
      { construct: 'empty-catch' },
      { construct: 'call' },
    ];

    expect(dedupeRequests(given)).toEqual(survivors);
  });

  test('an empty list dedupes to an empty list', () => {
    expect(dedupeRequests([])).toEqual([]);
  });
});

describe('requestsFingerprint', () => {
  test('the fingerprint reads the set, not the order or the repeats', () => {
    const base: SyntaxRequest[] = [
      { construct: 'call', target: 'fetch' },
      { construct: 'empty-catch' },
      { construct: 'reference', target: 'x' },
    ];

    expect(requestsFingerprint([...base].reverse())).toBe(requestsFingerprint(base));

    expect(requestsFingerprint([...base, { construct: 'empty-catch' }])).toBe(
      requestsFingerprint(base),
    );

    expect(requestsFingerprint(base.slice(0, -1))).not.toBe(requestsFingerprint(base));
  });

  test('an empty list fingerprints as the empty string', () => {
    expect(requestsFingerprint([])).toBe('');
  });
});
