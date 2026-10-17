import { describe, expect, test } from 'bun:test';
import type { Rule } from '../types.js';
import { forbiddenContract } from './forbidden.js';

const layer = (name: string, dimension?: string): Rule => ({
  id: `${name}-is-declared`,
  kind: 'layers',
  statement: `${name} is a declared layer`,
  severity: 'error',
  confidence: 'deterministic',
  params: {
    name,
    match: `src/${name}/**`,
    mayImport: '*',
    ...(dimension === undefined ? {} : { dimension }),
  },
  remedy: { summary: 'declare it' },
});

const ban = (params: Record<string, unknown>): Rule => ({
  id: 'a-ban',
  kind: 'forbidden',
  statement: 'this edge is banned',
  severity: 'error',
  confidence: 'deterministic',
  params,
  remedy: { summary: 'do not import it' },
});

/** The manifest the cases below are validated against: one default axis and one `runtime` axis. */
const RULES: Rule[] = [
  layer('checkout'),
  layer('payments'),
  { ...layer('client', 'runtime'), id: 'client-is-a-runtime' },
  { ...layer('server', 'runtime'), id: 'server-is-a-runtime' },
];

function errorsFor(params: Record<string, unknown>): string[] {
  const result = forbiddenContract.validate(ban(params), { rules: RULES });
  return result.ok ? [] : result.error;
}

describe('a side may name a dimension', () => {
  test('a declared dimension and a declared layer on it validate', () => {
    expect(errorsFor({ from: { runtime: 'client' }, to: { runtime: 'server' } })).toEqual([]);
  });

  test('the default axis still validates, because `layer` is a dimension like any other', () => {
    expect(errorsFor({ from: { layer: 'checkout' }, to: { layer: 'payments' } })).toEqual([]);
  });

  test('a dimension and the default axis together validate', () => {
    const errors = errorsFor({
      from: { layer: 'checkout', runtime: 'client' },
      to: { runtime: 'server' },
    });
    expect(errors).toEqual([]);
  });
});

describe('a side naming something nobody declared is a config error', () => {
  test('an unknown dimension names the dimensions that exist', () => {
    // The quiet failure: an axis nobody declared matches no edge, so the rule bans nothing and
    // looks satisfied on every run.
    const errors = errorsFor({ from: { zone: 'inner' }, to: { layer: 'payments' } });
    expect(errors).toEqual([
      "params.from names an unknown dimension 'zone' — declared dimensions are layer, runtime",
    ]);
  });

  test('a known dimension with an unknown layer names the layers on that axis', () => {
    const errors = errorsFor({ from: { runtime: 'clientt' }, to: { layer: 'payments' } });
    expect(errors).toEqual([
      "params.from.runtime names an unknown layer 'clientt' on dimension 'runtime' — " +
        'layers there are client, server',
    ]);
  });

  test('an unknown layer on the default axis is reported the same way', () => {
    const errors = errorsFor({ from: { layer: 'chekcout' }, to: { layer: 'payments' } });
    expect(errors).toEqual([
      "params.from.layer names an unknown layer 'chekcout' on dimension 'layer' — " +
        'layers there are checkout, payments',
    ]);
  });

  test('a dimension whose value is not a string is reported once', () => {
    const errors = errorsFor({ from: { runtime: 7 }, to: { layer: 'payments' } });
    expect(errors).toEqual([
      "params.from declares dimension 'runtime' as a non-string, so it can never match a layer name",
    ]);
  });
});

describe('a side still has to declare something', () => {
  test('a side with nothing but an except is rejected', () => {
    const errors = errorsFor({ from: { except: 'src/legacy/**' }, to: { layer: 'payments' } });
    expect(errors[0]).toContain('params.from declares nothing');
  });

  test('a package alongside a dimension matches nothing, so it is rejected', () => {
    const errors = errorsFor({
      from: { layer: 'checkout' },
      to: { package: 'x', runtime: 'server' },
    });
    expect(errors[0]).toContain(
      'params.to declares package alongside a layer, a dimension or a glob',
    );
  });
});
