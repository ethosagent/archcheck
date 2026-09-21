# 11 · Contract: encapsulation

**Milestone** v0.2 · **Depends on** 05, 09

> Module barrels as a declared property, and the deep-import ban generated from it.

## Why now

The rule most often broken by accident, and the one where the generated exports map moves it from
*detected* to *impossible*.

## In scope

- `encapsulation` kind: `module` glob, `publicSurface`
- Graph fragment: no edge into a module except through its public surface
- **Exports-map fragment** — the package's own `exports` field, so the deep path does not resolve
- Same-module imports are always allowed

## Out of scope

- Enforcing barrels in the consumer's published package — we emit, they commit

## Design

**Two sinks, one rule.** This is the case that forced `emit()` to return an array.

1. **graph** — catches deep imports inside the repo, where module resolution does not apply
2. **exports** — makes the deep path unresolvable for anything outside the package

The second is the promotion from *detected* to *impossible*, and it costs nothing extra once the
first exists.

**Watch the same-module case.** `modules/ledger/services/write.ts` importing
`modules/ledger/domain/supersede.ts` is a normal internal import, not a barrel violation. Only
edges that **cross a module boundary** are checked.

## Files

```
src/contracts/encapsulation.ts
src/emit/sinks/exports.ts
```

## Done when

- [ ] A deep import across modules is caught
- [ ] An internal import within one module is not
- [ ] The emitted exports map lists only public surfaces

## Tests

- [ ] Fixture: cross-module deep import, same-module deep import, barrel import
- [ ] Emitted exports map snapshot
