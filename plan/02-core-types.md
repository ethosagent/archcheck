# 02 · Core types

**Milestone** v0.1 · **Depends on** 01

> The five types every other plan refers to, plus the schema version and a Result helper.

## Why now

Everything downstream is a function between these. Getting them wrong means rewriting every probe
and reporter, so they land before any behaviour.

## In scope

- `Rule`, `RawFinding`, `Diagnostic`, `Fragment`, `RunResult`
- `ContractKind` union — the closed set of eight
- `Result<T,E>` for validation paths that must not throw
- `SCHEMA_VERSION = 1`, exported and stamped on every `Diagnostic`

## Out of scope

- Runtime validation of a manifest — that is plan 03
- Any type that only one module uses; those stay local and unexported

## Design

Copy the shapes from the LLD §2 verbatim. Three details that are easy to get wrong:

**1 · `identity` is computed, never supplied.** A probe returns evidence; the normaliser computes
`identity = sha256(ruleId + canonical(evidence))`. **Never include a line number.** This is what
makes the baseline survive a moved function.

**2 · `Diagnostic` extends `RawFinding`.** The normaliser only adds; it never rewrites what a probe
observed. Keeps probe output auditable against the final diagnostic.

**3 · Severity and confidence are orthogonal.** A `model` rule can be `error` in principle — it is
policy, not a type constraint. The default is what stops it; the type does not.

```ts
export const SCHEMA_VERSION = 1 as const;

export type ContractKind =
  | 'layers' | 'forbidden' | 'encapsulation' | 'naming'
  | 'required-file' | 'declared-field' | 'banned-syntax' | 'judgement';

export type Result<T, E = string[]> =
  | { ok: true; value: T } | { ok: false; error: E };
```

## Files

```
src/types.ts
src/result.ts
src/version.ts
```

## Done when

- [ ] Every type in LLD §2 exists and is exported from `src/index.ts`
- [ ] `SCHEMA_VERSION` is stamped by construction, not by each producer

## Tests

- [ ] Type-level tests: a `Diagnostic` cannot be built without `statement`, `confidence` and `remedy`
- [ ] `identity` helper is deterministic for reordered evidence keys
