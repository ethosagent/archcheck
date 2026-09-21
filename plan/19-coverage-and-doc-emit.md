# 19 · Coverage and doc emit

**Milestone** v0.4 · **Depends on** 03, 09

> Computed coverage, and the generated region of the patterns document.

## Why now

The piece no existing tool does, and the reason the manifest exists rather than a pile of configs.

## In scope

- `archcheck coverage` — the three counts and the automated percentage
- `rules.json` emitted for any document to consume
- A marked generated region in the patterns document, replaced on emit
- Hand-editing the region fails `emit --check`

## Out of scope

- Generating prose. Only the table and the counts are generated.

## Design

**Emit data, not HTML.** `rules.json` is the artifact; the document reads it. Keeps archcheck
independent of anyone's doc format, and makes the same data available to a dashboard later.

**The generated region is fenced:**

```html
<!-- archcheck:begin rules-table -->
...generated...
<!-- archcheck:end rules-table -->
```

**Coverage cannot be claimed.** The percentage is computed from the manifest at run time. Add a
rule with no check and the judgement count rises and the percentage falls, with no way to write a
nicer number by hand.

## Files

```
src/coverage/compute.ts
src/emit/sinks/docs.ts
src/cli/coverage.ts
```

## Done when

- [ ] `coverage` prints counts matching the manifest
- [ ] `rules.json` is emitted and schema-stable
- [ ] The fenced region is replaced idempotently
- [ ] Hand-editing inside the fence exits 3

## Tests

- [ ] Adding a judgement rule moves the percentage down
- [ ] Two consecutive emits produce identical output
