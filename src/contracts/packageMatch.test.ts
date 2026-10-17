import { expect, test } from 'bun:test';
import { packageMatches, packageMatchesAny } from './packageMatch.js';

test('an exact pattern matches only itself', () => {
  expect(packageMatches('lodash', 'lodash')).toBe(true);
  expect(packageMatches('lodash', 'lodash/fp')).toBe(false);
});

test('a /* pattern covers the package and its subpaths, and stops at the slash', () => {
  expect(packageMatches('lodash/*', 'lodash')).toBe(true);
  expect(packageMatches('lodash/*', 'lodash/fp/map')).toBe(true);
  expect(packageMatches('lodash/*', 'lodash-es')).toBe(false);
});

test('a scoped pattern behaves the same, and a list is read in order', () => {
  expect(packageMatches('@aws-sdk/*', '@aws-sdk/client-s3')).toBe(true);
  expect(packageMatches('@aws-sdk/*', '@aws-sdk-other/x')).toBe(false);
  expect(packageMatchesAny(['react', 'lodash/*'], 'lodash/fp')).toBe(true);
  expect(packageMatchesAny(['react'], 'lodash')).toBe(false);
});
