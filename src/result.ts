/**
 * Result for the validation paths that must not throw.
 *
 * What rule this enforces: a malformed manifest exits 2, never 1 — which means validation has to
 * be able to *return* every problem it found rather than throwing on the first. A thrown error
 * gives an agent one field name; a Result gives it all of them in one pass (LLD §1.6, plan 03).
 *
 * What a caller must know: `error` is a list by default, and collecting errors is the point.
 * Do not reach for exceptions in validate() paths.
 */
export type Result<T, E = string[]> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Collect a list of Results into one Result, concatenating every error rather than stopping. */
export function allOk<T>(results: Result<T>[]): Result<T[]> {
  const values: T[] = [];
  const errors: string[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(...r.error);
  }
  return errors.length > 0 ? err(errors) : ok(values);
}
