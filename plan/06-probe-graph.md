# 06 · Probe: graph

**Milestone** v0.1 · **Depends on** 04, 05

> The first probe. Runs layer rules against the graph and returns raw findings.

## Why now

Closes the loop from manifest to finding. After this plan the tool detects something real.

## In scope

- `GraphProbe implements Probe`
- `run()` — build the graph, evaluate every graph-kind rule, return findings
- `ingest()` — accept a previously written graph report instead of re-reading
- Diff scoping: evaluate only edges whose source file is in the changed set

## Out of scope

- Lint, structure and model probes
- Normalisation — plan 07

## Design

**Run or ingest, never both mandatory.** CI builds the graph once and writes
`.archcheck/graph.json`; other gates ingest it. Locally, `run()` is the convenience path.

**Diff scoping is edge-level.** Given a changed set, evaluate edges whose `from` is in it. An edge
into a changed file is not a new violation — the importer did not change.

**Findings carry evidence, not prose.**

```ts
{ ruleId: 'domain-no-service-import',
  file: 'modules/ledger/domain/supersede.ts', line: 4,
  evidence: { from: 'modules/ledger/domain', to: 'modules/ledger/services',
              fromLayer: 'domain', toLayer: 'service', specifier: '../services/write' } }
```

The `explain()` of the contract type turns that into a sentence. The probe never writes prose.

## Files

```
src/probes/graph.ts
src/probes/types.ts        # Probe, RunCtx, Skip
src/probes/index.ts
```

## Done when

- [ ] Runs against the fixture repo and finds the planted violation
- [ ] `ingest()` produces identical findings from a written report
- [ ] Diff scoping excludes edges from unchanged files

## Tests

- [ ] Fixture violation is found, with correct evidence fields
- [ ] run() and ingest() outputs are deep-equal
