# 18 · Reporter: SARIF

**Milestone** v0.4 · **Depends on** 08

> The CI and editor format, with our extras preserved.

## Why now

Code scanning, editor viewers and run-to-run diffing all consume SARIF natively. Writing it is
cheaper than any of those integrations individually.

## In scope

- `SarifReporter` emitting SARIF 2.1.0
- `rules[]` populated from the registry, with help text
- `confidence`, `tier`, `identity` and `remedy` in the `properties` bag
- `level` mapped from severity; advisory maps to `note`

## Out of scope

- Uploading it anywhere — that is a CI step, not our job

## Design

**The properties bag carries what SARIF has no field for.** Confidence, tier and the identity hash
go there; anything reading plain SARIF still gets file, line, rule and message.

**Severity mapping is opinionated:**

| ours | SARIF |
|---|---|
| error | `error` |
| warn | `warning` |
| advisory | `note` |

A model verdict is therefore never worse than a note in CI, whatever its rule severity says — which
is the advisory-by-default policy expressed where CI can see it.

## Files

```
src/report/sarif.ts
```

## Done when

- [ ] Output validates against the SARIF 2.1.0 schema
- [ ] `rules[]` includes every rule that produced a result
- [ ] Extras survive in `properties`

## Tests

- [ ] Schema validation in CI
- [ ] A model verdict lands as `note`
