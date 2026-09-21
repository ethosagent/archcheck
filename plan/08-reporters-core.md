# 08 · Reporters: terminal and json

**Milestone** v0.1 · **Depends on** 07

> The two audiences that matter first — a person at a prompt, and an agent in a loop.

## Why now

Without a reporter the tool has no output. These two are the whole v0.1 surface.

## In scope

- `TerminalReporter` — grouped by confidence, deterministic first
- `JsonReporter` — the full `RunResult`, schema-versioned
- `Reporter` interface and a small registry

## Out of scope

- SARIF — plan 18
- The blocking verdict reporter — plan 10, with the CLI

## Design

**Terminal output is ordered by authority.** Deterministic failures first, then proxies, then
advisories. A developer should be able to stop reading after the first group.

```
✗ 2 deterministic

  domain may not import services                    domain-no-service-import
    modules/ledger/domain/supersede.ts:4
    → invert the call: the service calls the domain, never the reverse

◑ 1 proxy · the check is narrower than the rule
○ 0 advisory
  3 baselined, not shown          --show-baselined to include
```

**JSON is the agent contract.** Never pretty-print by default, always include
`schemaVersion`, and always include `skipped` — an agent must be able to tell "clean" from "did not
run".

## Files

```
src/report/terminal.ts
src/report/json.ts
src/report/types.ts
src/report/index.ts
```

## Done when

- [ ] Terminal output groups by confidence and shows the remedy
- [ ] JSON round-trips a `RunResult` without loss
- [ ] `skipped` is present even when empty

## Tests

- [ ] Snapshot test on terminal output for a fixed RunResult
- [ ] JSON output validates against the published schema
