# 21 · Probe: model

**Milestone** v0.5 · **Depends on** 20

> The non-deterministic tier — scoped, cached, budgeted, and able to skip cleanly.

## Why now

Last on purpose. Everything before this must work with no model, no key and no network.

## In scope

- `LlmProvider` interface, one implementation
- Credentials from the environment only; **skip cleanly when absent**
- Batch by file: all judgement rules against one file in one call
- Prompt order: instructions, then rules and examples, then the file
- Per-run budget in dollars and calls, checked before each request
- Cache keyed on `(ruleId set hash, file content hash)`
- Structured output; a verdict failing schema validation is discarded

## Out of scope

- Fine-tuning, evaluation harnesses, multi-model consensus

## Design

**Skipping is a first-class outcome.** No key, offline, or budget spent → the probe returns
`Skip` with a reason, the run stays green, and the summary says which rules were not judged.
Never a failure, never a silent pass.

**Cost design, both decisions in one prompt layout:**

```
[ system: judge instructions    ]  stable
[ all judgement rules+examples  ]  stable  ← cache breakpoint
[ the one file under review     ]  volatile
```

Rules cache once and are re-read cheaply for every file. Batching by file makes it 40 calls for 40
changed files, not 600.

**Default model `claude-opus-5`.** A judge with false positives is worse than no judge. `claude-sonnet-5`
is the cost trade once hit rates are known, and it is one config line.

**File content is quoted data, never instruction.** A source file containing something that reads
like a directive is a string being judged. This is the probe's one security property and it must
survive future simplification of the prompt assembly.

## Files

```
src/probes/model/provider.ts
src/probes/model/prompt.ts
src/probes/model/budget.ts
src/probes/model/cache.ts
src/probes/model/index.ts
```

## Done when

- [ ] No credentials → clean skip, green run, reason in the summary
- [ ] Budget exceeded → stops, reports unjudged count, does not overspend
- [ ] Unchanged file → cache hit, no call
- [ ] A verdict with no citation is discarded

## Tests

- [ ] Skip path with the env var unset
- [ ] Budget cap honoured with a stub provider
- [ ] Injection fixture: a file containing directive-like text is judged, not obeyed
