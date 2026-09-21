# 05 · Contract: layers

**Milestone** v0.1 · **Depends on** 03, 04

> The first contract type, and the one the whole dependency law rests on.

## Why now

Proves the `ContractType` seam with the hardest case. Default-deny is a property of this kind, not
a setting.

## In scope

- `layers` kind: `name`, `match`, `mayImport[]`
- **Default deny** — an edge between two declared layers is forbidden unless allowed
- An unmatched file belongs to no layer and is reported as such
- `validate()`, `emit()`, `explain()`

## Out of scope

- Other contract kinds
- The `forbidden` kind — that is a one-edge special case, added later

## Design

**Default deny is the whole point.** Resolution order for an edge `A → B`:

```
1. A and B in the same layer            → allowed
2. B is external                        → allowed (a separate rule governs that)
3. B's layer ∈ A's layer.mayImport      → allowed
4. anything else                        → VIOLATION
5. A matches no layer                   → VIOLATION: 'unlayered', a different message
```

Case 5 matters more than it looks: a new folder nobody declared fails on its first commit rather
than being silently legal. That is the property that makes the rule set complete rather than
merely non-empty.

**`explain()` returns the remedy, not the symptom.**

```
domain may not import services
  modules/ledger/domain/supersede.ts → modules/ledger/services/write.ts
  domain may import: contracts, rules
  invert the call: the service calls the domain, never the reverse
```

**`emit()` returns fragments for two sinks** — the graph rule itself, and a lint rule whose message
carries the statement so the editor shows it without running archcheck.

## Files

```
src/contracts/layers.ts
src/contracts/registry.ts      # kind → ContractType
src/contracts/index.ts
```

## Done when

- [ ] Every resolution case above has a test
- [ ] An unlayered file produces its own distinct message
- [ ] `emit()` returns fragments for both the graph and lint sinks

## Tests

- [ ] Fixture repo with a legal edge, an illegal edge, and an unlayered file
- [ ] `validate()` rejects a layer with an unknown name in `mayImport`
