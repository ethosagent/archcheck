# 03 · Manifest and registry

**Milestone** v0.1 · **Depends on** 02

> `defineArchitecture()`, config loading, validation, and the rules that keep rule ids trustworthy.

## Why now

The registry is the only thing that knows a rule exists. Every later plan reads from it.

## In scope

- `defineArchitecture(config)` — typed, no runtime magic
- Loading `architecture.config.ts` from the consumer repo
- Validation: every rule's `params` checked by its contract type
- Id rules: immutability, `replaces`, duplicate detection
- `registry.byId()`, `registry.all()`, `registry.coverage()`

## Out of scope

- Emitting anything — plan 09
- Running anything — plans 06 onward

## Design

**Loading.** The config is TypeScript, so it must be compiled to be read. Use the consumer's own
`typescript` (peer dep) to transpile a single file in memory — no bundler, no `ts-node`, no
temporary files on disk.

**Validation is total.** A malformed manifest exits **2**, never 1. An agent must be able to tell
"the config is broken" from "the code is broken", or it will try to fix the wrong thing.

**Id immutability, enforced.** A committed `.archcheck/ids.json` lists every id ever published.
Loading fails if a listed id is absent and nothing declares `replaces` for it.

```
id disappeared: domain-no-service-import
  → either restore it, or add a rule with replaces: 'domain-no-service-import'
  ids are immutable because the baseline and every past annotation key off them
```

**Coverage is computed, never stored.** `registry.coverage()` counts by `confidence` at load time.
Nobody can claim a number the manifest does not support.

## Files

```
src/registry/define.ts        # defineArchitecture
src/registry/load.ts          # find + transpile + import
src/registry/validate.ts
src/registry/ids.ts           # immutability check
src/registry/index.ts
```

## Done when

- [ ] A valid manifest loads and indexes
- [ ] A malformed manifest exits 2 with the offending rule and field named
- [ ] A removed id without `replaces` fails the load
- [ ] `coverage()` returns counts that match the manifest

## Tests

- [ ] Fixture manifests: valid, malformed params, duplicate id, removed id
- [ ] Transpile path works with no `ts-node` and no temp files
