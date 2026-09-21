# archcheck's own rules

This is the architecture archcheck holds itself to. If it cannot hold its own dependency law, it
has no business holding anyone else's.

The table below is **generated** from [`architecture.config.ts`](architecture.config.ts). Do not
edit inside the fence — change the manifest and run `bun run emit`. The counts are computed, so
nobody can write a nicer number by hand: add a rule with no check and the judgement count goes up
and the percentage goes down, in the same commit.

- ✓ **deterministic** — a script decides. No judgement, no model, no reader.
- ◑ **proxy** — the check catches the practical violations, but the rule as written is broader.
- ○ **judgement** — needs a reader or a model.

<!-- archcheck:begin rules-table -->

**24 rules** · ✓ 23 deterministic · ◑ 1 proxy · ○ 0 judgement · **100% automatable**

| | Rule | Statement | Kind | Severity |
|---|---|---|---|---|
| ✓ | `cli-owns-no-behaviour` | the CLI parses arguments, calls the facade and picks a reporter — nothing else | layers | error |
| ✓ | `contracts-know-no-probe` | a contract kind decides, emits and explains — it never runs anything | layers | error |
| ✓ | `coverage-is-computed-from-rules-alone` | coverage counts rules and renders a table, and checks nothing | layers | error |
| ✓ | `emit-reads-contracts-not-probes` | the emitter asks a contract kind for fragments and never runs a probe | layers | error |
| ✓ | `every-error-rule-has-a-fixture` | every error-severity rule has a fixture it is proven to catch | required-file | error |
| ✓ | `exceptions-are-a-leaf` | exceptions decide suppression from paths and dates, and run no check | layers | error |
| ✓ | `filenames-are-camel-case-or-kebab` | a filename is camelCase, or kebab-case when it names a contract kind | naming | error |
| ✓ | `graph-reports-facts-only` | the graph reader reports facts and evaluates no rule | layers | error |
| ✓ | `init-infers-and-writes-nothing-else` | init reads the folder structure and the graph, and runs no rule | layers | error |
| ✓ | `kernel-imports-nothing` | the kernel imports nothing internal — not a layer, and not the TypeScript SDK | layers | error |
| ✓ | `no-computed-dynamic-import` | a dynamic import names its module literally, so the graph stays complete | banned-syntax | error |
| ✓ | `no-console-outside-an-entry-point` | logging goes through one seam, so the server stays embeddable | banned-syntax | error |
| ✓ | `no-empty-catch` | a caught error is handled, rethrown, or its silence is explained | banned-syntax | error |
| ◑ | `no-inline-suppression` | an exception lives in the manifest with an owner and an expiry, never inline | banned-syntax | error |
| ✓ | `normalize-adds-only` | the normaliser enriches a finding and runs no check of its own | layers | error |
| ✓ | `only-the-facade-wires-layers` | the facade is the one place the layers are wired together | layers | error |
| ✓ | `probes-never-report` | a probe returns evidence, never prose and never a verdict | layers | error |
| ✓ | `registry-knows-only-rules` | the registry knows that a rule has a kind, never what a kind means | layers | error |
| ✓ | `reporters-read-a-runresult` | a reporter reads a RunResult and reaches for nothing else | layers | error |
| ✓ | `tests-reach-anything` | a test may reach any layer, because its job is to look at one | layers | error |
| ✓ | `the-baseline-is-a-leaf` | the baseline reads and writes one file and knows nothing about rules | layers | error |
| ✓ | `the-filesystem-is-a-leaf` | the filesystem seam reads and writes and decides nothing | layers | error |
| ✓ | `the-manifest-reaches-the-barrel-only` | the manifest imports archcheck through its public surface, like any consumer | layers | error |
| ✓ | `util-is-a-leaf` | a utility reaches the kernel and nothing else | layers | error |

<!-- archcheck:end rules-table -->
