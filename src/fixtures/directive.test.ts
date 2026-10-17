import { expect, test } from 'bun:test';
import { readDirective } from './directive.js';

const head = '// archcheck-fixture:';

test('the two path directives are read with their paths', () => {
  const placeAt = `${head} place-at src/a.ts`;
  const appendTo = `${head} append-to src/a.ts`;

  expect(readDirective(placeAt)).toEqual({ kind: 'place-at', path: 'src/a.ts' });
  expect(readDirective(appendTo)).toEqual({ kind: 'append-to', path: 'src/a.ts' });
});

test('verified-by is read, and its quotes are stripped', () => {
  const verified = `${head} verified-by "the name"`;
  const later = `const a = 1;\n${head} place-at src/b.ts`;

  expect(readDirective(verified)).toEqual({ kind: 'verified-by', test: 'the name' });
  expect(readDirective(later)).toEqual({ kind: 'place-at', path: 'src/b.ts' });
});

test('no directive and an unknown kind are both undefined', () => {
  expect(readDirective('export const a = 1;')).toBeUndefined();
  expect(readDirective(`${head} place=src/a.ts`)).toBeUndefined();
});
