# 20 · Contract: judgement

**Milestone** v0.5 · **Depends on** 05

> Rules in plain English, with enough structure to be checkable.

## Why now

The other fifteen. One registry for every rule is the goal; this is the kind that makes it possible.

## In scope

- `judgement` kind: `statement`, `appliesTo`, `examples.pass`, `examples.fail`, `cite`
- Validation: examples and `cite` are **required**, not optional
- `severity` defaults to `advisory` and validation warns on anything else
- `confidence` is forced to `model`

## Out of scope

- The model call — plan 21. This plan is the kind only.

## Design

**Examples are required because they are the quality lever.** A rule with a sentence and no
examples flags everything, people stop reading the advisory stream, and the whole tier dies. The
validator refuses to load one.

**`cite` forces falsifiability.** The model must return the span it judged. A verdict with no
citation is discarded by the probe, which removes most confident-sounding noise for free.

**Severity is policed at load.** Setting a judgement rule to `error` is allowed but emits a warning
naming the rule, so promoting one is a visible act rather than a quiet default.

## Files

```
src/contracts/judgement.ts
```

## Done when

- [ ] A judgement rule without examples fails validation
- [ ] A judgement rule without `cite` fails validation
- [ ] `confidence` is `model` regardless of what the manifest says
- [ ] `severity: error` loads but warns

## Tests

- [ ] Validation fixtures for each missing field
