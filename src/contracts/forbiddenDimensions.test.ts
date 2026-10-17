import { describe, expect, test } from 'bun:test';
import { dimensionProblems, dimensionsOfSide, sideDimensionsMatch } from './forbiddenDimensions.js';

describe('dimensionsOfSide', () => {
  test('a dimension key is kept, and a reserved key is not', () => {
    expect(dimensionsOfSide({ glob: 'src/**', runtime: 'client' })).toEqual({ runtime: 'client' });
  });

  test('a side of reserved keys alone names no dimension', () => {
    expect(dimensionsOfSide({ glob: 'a', except: 'b', package: 'c' })).toEqual({});
  });

  test('the default axis is a dimension like any other', () => {
    expect(dimensionsOfSide({ layer: 'ui' })).toEqual({ layer: 'ui' });
  });
});

describe('sideDimensionsMatch', () => {
  const rows: [string, Record<string, unknown>, Record<string, string | undefined>, boolean][] = [
    ['the same name on the same axis', { runtime: 'client' }, { runtime: 'client' }, true],
    ['a different name on that axis', { runtime: 'client' }, { runtime: 'server' }, false],
    ['no layer on that axis at all', { runtime: 'client' }, { layer: 'ui' }, false],
    ['the default axis, as before', { layer: 'ui' }, { layer: 'ui' }, true],
    ['a reserved key constrains nothing', { glob: 'src/**' }, { layer: 'ui' }, true],
    ['a side naming no axis', {}, {}, true],
    ['a value that is not a string', { runtime: 7 }, { runtime: 'client' }, false],
  ];

  test('a side matches only when every axis it names agrees', () => {
    for (const [, side, layers, expected] of rows) {
      expect(sideDimensionsMatch(side, layers)).toBe(expected);
    }
  });

  test('both axes have to agree, not either one', () => {
    const side = { layer: 'ui', runtime: 'client' };
    expect(sideDimensionsMatch(side, { layer: 'ui', runtime: 'client' })).toBe(true);
    expect(sideDimensionsMatch(side, { layer: 'ui', runtime: 'server' })).toBe(false);
  });
});

describe('dimensionProblems', () => {
  const unknown = (known: string) =>
    `names an unknown dimension 'runtime' — declared dimensions are ${known}`;
  const notString = `declares dimension 'runtime' as a non-string, so it can never match a layer name`;

  test('a declared dimension is no problem', () => {
    expect(dimensionProblems({ runtime: 'client' }, ['layer', 'runtime'])).toEqual([]);
  });

  test('a reserved key is never a dimension problem', () => {
    expect(dimensionProblems({ glob: 'src/**' }, ['layer'])).toEqual([]);
  });

  test('an unknown dimension names the ones that exist', () => {
    expect(dimensionProblems({ runtime: 'client' }, ['layer', 'zone'])).toEqual([
      unknown('layer, zone'),
    ]);
  });

  test('a repository with no dimensions says so', () => {
    expect(dimensionProblems({ runtime: 'client' }, [])).toEqual([unknown('none')]);
  });

  test('a non-string value is reported once, and not also as unknown', () => {
    expect(dimensionProblems({ runtime: 7 }, ['layer', 'runtime'])).toEqual([notString]);
    expect(dimensionProblems({ runtime: 7 }, ['layer'])).toEqual([notString]);
  });
});
