# 16 · Contracts: required-file and declared-field

**Milestone** v0.4 · **Depends on** 05

> Rules about what must exist, and what must be declared — including the fixture obligation.

## Why now

These two kinds carry the rules a graph cannot see: a missing twin, a missing story, an endpoint
with no permission.

## In scope

- `required-file`: `forEach`, `expect` template
- `declared-field`: `on`, `field`, optional allowed values
- `forEach` can iterate files, exports, or **rules in the registry**

## Out of scope

- Validating the *content* of the required file — existence is the rule

## Design

**`forEach: 'rule[severity=error]'` is the self-referential case**, and it is the one that makes
"test the checker" a gate:

```ts
{ id: 'every-error-rule-has-a-fixture', kind: 'required-file',
  params: { forEach: 'rule[severity=error]', expect: 'fixtures/{id}.violation.ts' } }
```

A rule that cannot catch a deliberate violation passes every build and looks exactly like
compliance. This is the rule that catches that.

**`declared-field` is AST work, not filesystem work.** "Every route registration passes a
permission" means finding the call expression and checking its arguments — which needs the program
from plan 04.

## Files

```
src/contracts/required-file.ts
src/contracts/declared-field.ts
```

## Done when

- [ ] A missing twin is reported against the port that needs it
- [ ] An endpoint with no permission argument is reported
- [ ] `forEach: 'rule[...]'` iterates the registry

## Tests

- [ ] Fixture: port without a twin; route without a permission
- [ ] The fixture rule catches a rule that has no fixture
