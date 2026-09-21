# archcheck — plan

An AI-first architecture conformance engine. Rules are declared once, checked at six moments, and
returned as typed diagnostics a model can act on — the same way, every time.

**The design.** [architecture-checks.html](architecture-checks.html) explains how checking works
and why. [archcheck-lld.html](archcheck-lld.html) is the reviewed build spec. Read the LLD before
starting any plan below.

**Status: nothing is built.** These are plans.

---

## Decisions already made

| Question | Decision |
|---|---|
| Module graph | **We own it**, via the TypeScript compiler API. Needed for line-independent identity hashes, type-aware layer matching, and one parse shared by every probe. |
| First target | **A synthetic fixture repo.** archcheck cannot dogfood a codebase that does not exist, and the fixtures are needed for the self-test suite regardless. |
| Runtime | **Node-compatible, run with Bun.** No Bun-only API in `src/`, enforced by lint from day one. |
| Where it lives | `packages/archcheck/` in the main repo, published to npm from there. Extract only if a second repo depends on it. |
| Fixtures | Two suites: generic ones in the package, rule-specific ones in the consumer. The consumer's are mandatory, enforced by a rule. |
| Judgement model | Default `claude-opus-5`, advisory-only, credentials from the environment, clean skip when absent. |

---

## The plans, in build order

| # | Plan | Milestone | Goal |
|---|---|---|---|
| 01 | [Scaffolding](01-scaffolding.md) | `v0.1` | An empty package that builds, lints, type-checks and runs its own gates in CI. |
| 02 | [Core types](02-core-types.md) | `v0.1` | The five types every other plan refers to, plus the schema version and a Result helper. |
| 03 | [Manifest and registry](03-manifest-and-registry.md) | `v0.1` | `defineArchitecture()`, config loading, validation, and the rules that keep rule ids trustworthy. |
| 04 | [Graph reader](04-graph-reader.md) | `v0.1` | Our own module graph, read with the TypeScript compiler API. The core asset everything else reads. |
| 05 | [Contract: layers](05-contract-layers.md) | `v0.1` | The first contract type, and the one the whole dependency law rests on. |
| 06 | [Probe: graph](06-probe-graph.md) | `v0.1` | The first probe. Runs layer rules against the graph and returns raw findings. |
| 07 | [Normalizer](07-normalizer.md) | `v0.1` | RawFinding + Rule → Diagnostic, including the identity hash the baseline depends on. |
| 08 | [Reporters: terminal and json](08-reporters-core.md) | `v0.1` | The two audiences that matter first — a person at a prompt, and an agent in a loop. |
| 09 | [Emit pipeline](09-emit-pipeline.md) | `v0.1` | Fragments from every rule, merged per sink, written with a generated header and staleness check. |
| 10 | [CLI and exit codes](10-cli.md) | `v0.1` | The command surface, the exit codes an agent depends on, and the programmatic entry point. |
| 11 | [Contract: encapsulation](11-contract-encapsulation.md) | `v0.2` | Module barrels as a declared property, and the deep-import ban generated from it. |
| 12 | [Contracts: naming and banned-syntax](12-contracts-naming-syntax.md) | `v0.2` | The two kinds that cover most of the lint tier in one pass. |
| 13 | [Probe: lint](13-probe-lint.md) | `v0.2` | Evaluate naming and banned-syntax rules over our own program, and ingest an external linter's report. |
| 14 | [Baseline ratchet](14-baseline-ratchet.md) | `v0.3` | Adopt a rule on a codebase that already violates it, without a flag day. |
| 15 | [Exceptions](15-exceptions.md) | `v0.3` | A deliberate, owned, expiring allowance — the only legitimate way past a rule. |
| 16 | [Contracts: required-file and declared-field](16-contracts-structure.md) | `v0.4` | Rules about what must exist, and what must be declared — including the fixture obligation. |
| 17 | [Probe: structure](17-probe-structure.md) | `v0.4` | Runs the filesystem and AST-shape rules. |
| 18 | [Reporter: SARIF](18-reporter-sarif.md) | `v0.4` | The CI and editor format, with our extras preserved. |
| 19 | [Coverage and doc emit](19-coverage-and-doc-emit.md) | `v0.4` | Computed coverage, and the generated region of the patterns document. |
| 20 | [Contract: judgement](20-contract-judgement.md) | `v0.5` | Rules in plain English, with enough structure to be checkable. |
| 21 | [Probe: model](21-probe-model.md) | `v0.5` | The non-deterministic tier — scoped, cached, budgeted, and able to skip cleanly. |
| 22 | [Fixtures and self-test](22-fixtures-and-selftest.md) | `v0.5` | Two fixture suites with different jobs, and the rule that makes the consumer's suite mandatory. |
| 23 | [Publish and adopt](23-publish.md) | `v0.5` | Ship it to npm, then adopt it into World Engine wave 0. |

---

## Milestones

| | Contains | Proves |
|---|---|---|
| **v0.1** | 01–10 | One rule, end to end: manifest → emitted config → violation → diagnostic → two reporters. The walking skeleton. |
| **v0.2** | 11–13 | The structural rule set, and **archcheck checking archcheck**. |
| **v0.3** | 14–15 | Adoption: the ratchet and owned, expiring exceptions. Without these it cannot be switched on anywhere that has code. |
| **v0.4** | 16–19 | The remaining deterministic rules, SARIF, and computed coverage. |
| **v0.5** | 20–23 | The judgement tier, fixtures, publish, adopt. |

---

## How to read a plan

Each has the same shape: **goal**, **why now**, **in / out of scope**, **design** (the decisions,
with the reasoning that will otherwise be lost), **files**, **done when**, **tests**.

Three standing rules for every plan:

1. **A plan is done when its gate is green**, not when the code is written.
2. **Every rule ships with a fixture that must fail.** A rule matching nothing looks exactly like
   compliance.
3. **No plan may start before the one it depends on is done.** The dependency column is not advice.
