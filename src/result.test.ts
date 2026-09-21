import { describe, expect, test } from 'bun:test';
import { allOk, err, ok, type Result } from './result.js';

describe('Result', () => {
  test('ok carries the value', () => {
    const r = ok(3);
    expect(r).toEqual({ ok: true, value: 3 });
  });

  test('allOk collects EVERY error rather than stopping at the first', () => {
    const results: Result<number>[] = [ok(1), err(['a bad']), ok(2), err(['b bad'])];
    const collected = allOk(results);
    expect(collected.ok).toBe(false);
    if (!collected.ok) expect(collected.error).toEqual(['a bad', 'b bad']);
  });

  test('allOk returns every value when all are ok', () => {
    expect(allOk([ok(1), ok(2)])).toEqual({ ok: true, value: [1, 2] });
  });
});
