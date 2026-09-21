# 13 · Probe: lint

**Milestone** v0.2 · **Depends on** 12

> Evaluate naming and banned-syntax rules over our own program, and ingest an external linter's report.

## Why now

Completes the v0.2 structural set and turns on self-hosting.

## In scope

- `LintProbe` evaluating AST-selector and naming rules in process
- `ingest()` for an external linter's JSON, mapped back by rule id
- Self-hosting: archcheck's own `architecture.config.ts`

## Out of scope

- Writing a linter plugin — we emit config for theirs and evaluate our own in process

## Design

**Why evaluate in process at all**, given we emit lint config? Two reasons: the editor path uses
the emitted config, but CI should not need the linter installed; and our findings carry evidence
the linter cannot express.

**Self-hosting starts here.** archcheck gets a manifest declaring its own layers:

```
contracts(types) ← registry ← contracts/* ← probes ← normalize ← report ← cli
```

`check-selfhost.sh` stops being a stub. If archcheck cannot pass its own rules, the plan is wrong
and we find out at v0.2 rather than at v0.5.

## Files

```
src/probes/lint.ts
architecture.config.ts      # archcheck's own manifest
scripts/check-selfhost.sh   # unstubbed
```

## Done when

- [ ] Naming and syntax rules produce findings without an external linter
- [ ] `ingest()` maps an external report back by rule id
- [ ] `bun run check` includes a green self-host run

## Tests

- [ ] Self-host run is green
- [ ] A deliberate layer violation inside `src/` turns it red
