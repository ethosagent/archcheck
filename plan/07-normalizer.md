# 07 · Normalizer

**Milestone** v0.1 · **Depends on** 02, 03, 06

> RawFinding + Rule → Diagnostic, including the identity hash the baseline depends on.

## Why now

The single place where a finding becomes something an agent can act on.

## In scope

- Enrichment: statement, severity, confidence, remedy, `detectedBy`, `schemaVersion`
- Identity hash computation
- Deduplication by identity
- `baselined` flag — set here, consumed by the reporters

## Out of scope

- The baseline file itself — plan 14; this plan only sets the flag from an injected set

## Design

**Identity is the contract with the future.**

```ts
identity = sha256([ruleId, canonicalJson(evidence)].join('\u0000')).slice(0, 16)
```

`canonicalJson` sorts keys and normalises paths to repo-relative POSIX. **No line, no column, no
absolute path.** Moving a function must not produce a new identity, or the baseline ratchet becomes
noise and people stop trusting it.

**Deduplicate before reporting.** Two probes may legitimately observe the same violation — the
graph sees the edge, lint sees the statement. Same identity, one diagnostic, `detectedBy` becomes
a list.

**The normaliser never drops a finding.** A finding whose `ruleId` is not in the registry is an
error, not a silent skip — it means an emitted config has drifted from the manifest.

## Files

```
src/normalize/identity.ts
src/normalize/normalize.ts
src/normalize/index.ts
```

## Done when

- [ ] A finding becomes a complete `Diagnostic`
- [ ] Identity is stable across a line move and a whitespace change
- [ ] Duplicate findings from two probes collapse to one
- [ ] An unknown ruleId is a hard error

## Tests

- [ ] Identity stability: same fixture, code shifted down 20 lines, same hash
- [ ] Key-order independence in evidence
