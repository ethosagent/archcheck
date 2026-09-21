# 22 · Fixtures and self-test

**Milestone** v0.5 · **Depends on** all

> Two fixture suites with different jobs, and the rule that makes the consumer's suite mandatory.

## Why now

The step everyone skips. A rule whose pattern matches nothing passes every build and is
indistinguishable from compliance.

## In scope

- **Package fixtures** — tiny synthetic repos, one per contract kind, proving the mechanism
- **Consumer fixtures** — one deliberate violation per rule instance, in the real layout
- The `every-error-rule-has-a-fixture` rule, enabled
- A harness asserting each fixture is caught by exactly its own rule

## Out of scope

- Fixtures for advisory rules — useful, not required

## Design

**Two suites, two questions.**

| Suite | Lives in | Answers |
|---|---|---|
| package | `fixtures/kinds/` | does `layers` emit, detect and normalise correctly? |
| consumer | `fixtures/rules/` | does *this rule, as configured here*, catch anything? |

The first is generic and ships with archcheck. The second is repo-shaped and belongs to whoever
adopts it.

**Exactly its own rule.** The harness asserts a fixture produces the expected rule id **and no
others**. A fixture that trips three rules is testing nothing in particular.

```
fixtures/rules/domain-no-service-import.violation.ts
  → expect exactly: ['domain-no-service-import']
```

## Files

```
fixtures/kinds/<kind>/...
fixtures/rules/<ruleId>.violation.ts
tests/fixtures.test.ts
```

## Done when

- [ ] Every contract kind has a package fixture
- [ ] Every error-severity rule has a consumer fixture
- [ ] Each fixture is caught by exactly its own rule
- [ ] Deleting a fixture fails the run

## Tests

- [ ] Harness asserts exact rule-id match per fixture
- [ ] Removing a fixture turns the self-host run red
