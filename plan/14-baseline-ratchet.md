# 14 · Baseline ratchet

**Milestone** v0.3 · **Depends on** 07, 10

> Adopt a rule on a codebase that already violates it, without a flag day.

## Why now

Without this, no rule can ever be turned on anywhere that already has code — including our own repo
one release from now.

## In scope

- `.archcheck/baseline.json` keyed by identity hash
- `baseline --write`, `baseline --prune`
- Run fails only on identities not in the baseline
- **Exit 4** when a baselined identity no longer reproduces
- Per-entry `addedAt` and the rule id, for auditing

## Out of scope

- Per-rule violation *counts* — identity matching is strictly better and we have the hashes

## Design

**Identity, not counts, not lines.** Because identity comes from evidence rather than position,
moving code does not resurrect a finding and does not create a phantom one.

```json
{ "version": 1,
  "entries": [ { "identity": "a3f2...", "ruleId": "domain-no-service-import",
                 "addedAt": "2026-09-21", "note": "pre-existing at adoption" } ] }
```

**The ratchet only turns one way.** A baselined finding that no longer reproduces exits **4**, not
0. Otherwise the file silently over-suppresses forever — the failure mode that makes baselines
worthless everywhere they are used badly.

**Not the same as an exception.** A baseline entry is debt with no owner and no expiry, recorded so
work can continue. An exception (plan 15) is a deliberate permanent allowance. Conflating them is
how debt becomes policy.

## Files

```
src/baseline/read.ts
src/baseline/write.ts
src/baseline/apply.ts
src/cli/baseline.ts
```

## Done when

- [ ] A pre-existing violation is baselined and stops failing
- [ ] A new violation of the same rule still fails
- [ ] A fixed baselined violation exits 4 until pruned
- [ ] Moving the offending code does not change its identity

## Tests

- [ ] Move the violating code 30 lines; baseline still matches
- [ ] Fix it; exit 4; prune; exit 0
