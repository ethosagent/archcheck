# 10 · CLI and exit codes

**Milestone** v0.1 · **Depends on** 08, 09

> The command surface, the exit codes an agent depends on, and the programmatic entry point.

## Why now

Closes v0.1. After this plan the walking skeleton is walking.

## In scope

- `archcheck`, `--changed`, `--format`, `--only`
- `archcheck emit`, `emit --check`
- `archcheck explain <ruleId>`
- Exit codes 0–4 exactly as specified
- `ArchCheck.load()` / `.check()` / `.emit()` / `.explain()` — the facade
- `VerdictReporter` for the hook path

## Out of scope

- `baseline` and `coverage` subcommands — plans 14 and 19

## Design

**Exit codes are an API.** An agent branches on them, so they are frozen from v0.1:

| Code | Meaning | What an agent should do |
|---|---|---|
| 0 | clean, or only baselined and advisory | proceed |
| 1 | new error-severity violations | fix the code |
| 2 | configuration invalid | fix the manifest, **not** the code |
| 3 | emitted output stale | run `archcheck emit` |
| 4 | baselined finding no longer reproduces | run `archcheck baseline --prune` |

**The facade is thin on purpose.** The CLI is `parse args → ArchCheck method → reporter`. Every
behaviour is reachable programmatically, because the agent hook does not shell out.

**`explain` is for the loop.** Given a rule id: the statement, why it exists, the allowed
alternatives, and current violations. It is what an agent calls when a diagnostic is not enough.

## Files

```
src/cli/index.ts
src/cli/args.ts
src/archcheck.ts          # the facade
src/report/verdict.ts
```

## Done when

- [ ] Each exit code is produced by a fixture scenario
- [ ] `--format json` and `--format sarif` route to the right reporter
- [ ] The facade covers every CLI behaviour with no shelling out

## Tests

- [ ] One test per exit code
- [ ] `explain` output includes statement, remedy and live violation count
