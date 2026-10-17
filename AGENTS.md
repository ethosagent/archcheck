# AGENTS.md — how to work in this repository

This is the operating contract for any agent changing this codebase. Read it before you edit.

`CLAUDE.md` points here. They are one document under two names.

> **Adapted, not copied.** Several rules below arrived phrased for a `pnpm` monorepo with an
> `ARCHITECTURE.md` and a `packages/types/`. This repository has none of those. Each rule is
> restated against what actually enforces it **here**, and the substitution is named inline. A rule
> that points at a file which does not exist is a rule nobody can follow.

---

## 0. The one-line orientation

archcheck is an architecture conformance engine. You declare a rule once in
[`architecture.config.ts`](architecture.config.ts); archcheck generates the configuration that
enforces it and checks the code itself.

**archcheck checks archcheck.** Its own manifest is `architecture.config.ts`. Its own rule table is
[`RULES.md`](RULES.md), which is generated. `bun run check` runs every gate, including the
self-host run.

---

## 1. Think before coding

Do not assume. Do not hide confusion. Surface tradeoffs.

Before you implement:

- State your assumptions explicitly. If you are uncertain, ask.
- If several readings exist, present them. Do not pick one silently.
- If a simpler approach exists, say so. Push back when it is warranted.
- If something is unclear, stop. Name what is confusing. Ask.

## 2. Simplicity first

Write the minimum code that solves the problem. Write nothing speculative.

- No feature beyond what was asked.
- No abstraction for single-use code.
- No flexibility or configurability that nobody requested.
- No error handling for an impossible case.
- If you write 200 lines and 50 would do, rewrite it.

### The ladder — climb it before you write code

This repository is written against **ponytail**, a lazy-senior-dev decision ladder. The full skill
is [`.agents/skills/ponytail/SKILL.md`](.agents/skills/ponytail/SKILL.md), and `.claude/skills` is a
symlink to `.agents/skills`, so a Claude session loads it automatically. The rungs are restated here
because a rule that only names a file is a rule people skip.

Understand the problem first — read the task and the code it touches, and trace the real flow. Then
climb, and **stop at the first rung that holds**:

1. Does this need to be built at all?
2. Does it already exist in this codebase? Reuse the helper or pattern that is here.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

Alongside the rungs:

- No abstraction that nobody requested. No new dependency you can avoid. No boilerplate.
- Deletion over addition. Boring over clever. The fewest files possible.
- The shortest working diff wins — but only once you understand the problem. The smallest change in
  the wrong place is a second bug.
- Question a complex request: "do you need X, or does Y cover it?"
- A bug fix goes to the **root cause**. Grep every caller of the function you touch and fix the
  shared function once. Patching only the path the report names leaves a sibling caller broken.
- Mark a deliberate simplification that cuts a real corner with a `ponytail:` comment naming the
  ceiling and the upgrade path. `grep -rn 'ponytail:' src` finds every one. The count is left out
  of this sentence on purpose: a number in prose drifts the moment somebody adds a marker, and it
  already had.

**Never lazy about:** understanding the problem, validation at a trust boundary, error handling that
prevents data loss, security, and anything explicitly requested. Lazy code without its check is
unfinished — non-trivial logic leaves one runnable check behind.

Three decisions in this repository came from the ladder, and each is worth copying:

| Rung | The decision |
|---|---|
| 2 — it already exists | `src/emit/sinks/exports.ts` was never created, because `mergeBySink` already writes any JSON sink. |
| 1 — does it need building | `banned-syntax` takes a **closed set of six constructs**, not a CSS-style selector language. An unknown selector fails validation instead of silently matching nothing. |
| boring over clever | A conditional type in the lint probe was replaced with `ModuleGraph`. |

## 3. Surgical changes

Touch only what you must. Clean up only your own mess.

- Do not improve adjacent code, comments, or formatting.
- Do not refactor what is not broken.
- Match the existing style, even where you would do it differently.
- Remove an import, variable, or function that your change made unused.
- Every changed line traces directly to the request.

## 4. Goal-driven execution

Define the success criterion first. Loop until you have verified it.

- "Add validation" → write the tests for invalid input, then make them pass.
- "Fix the bug" → write the test that reproduces it, then make it pass. **The reproducing test
  lands first.**
- Run `bun run check` before you declare anything done.

> **Substitution.** This repository uses **bun**, not pnpm. `bun run check` runs every gate
> through [`scripts/run-checks.sh`](scripts/run-checks.sh): typecheck, lint, tests, emit and
> selfhost. There is no separate `lint:fix`; run `bunx biome check --write .`, then re-run
> `bun run check`. The pre-push hook and CI run the same scripts, so local equals CI by
> construction.

## 5. Surface conflicts, do not average them

If two patterns in the codebase contradict, do not blend them. Pick one — the more recent, or the
better tested — explain why, and flag the other for cleanup. Code that satisfies both rules is the
worst code.

## 6. Ask before you add to code you do not understand

"It looks orthogonal to me" is the most expensive sentence in this codebase. If you cannot say why
existing code is shaped the way it is, ask before you put anything next to it.

## 7. Follow the constitution

> **Substitution.** There is no `ARCHITECTURE.md` here. The constitution is
> [`architecture.config.ts`](architecture.config.ts), and it is **machine-enforced**: the
> `selfhost` gate runs archcheck against this repository on every `bun run check`. A violation is
> a failing gate, not a review comment. [`RULES.md`](RULES.md) is its generated, readable form.

Read the manifest before you:

- Add a folder under `src/`. Every folder is a declared layer, and an undeclared one fails on its
  first commit — enforced by `only-the-facade-wires-layers`, which carries `catchesUnlayered`.
- Add an import that crosses a layer.
- Change the kernel — `src/types.ts`, `src/result.ts`, `src/version.ts`. It imports nothing,
  enforced by `kernel-imports-nothing`.
- Touch the prompt-injection fence in `src/probes/model/prompt.ts`. That is this repository's one
  security property; `renderFileBlock` neutralises the closing fence, and
  `src/probes/model/model.test.ts` pins it.
- Change `Diagnostic`, `RunResult`, `Rule`, or `SCHEMA_VERSION`. These are the agent contract.
- Add a `console.*` call outside `src/cli/**` or `src/report/**` — enforced by
  `no-console-outside-an-entry-point`.

If your change conflicts with the manifest, refactor to fit it, or change the manifest **in its own
reviewed commit** with the reason stated. Do not weaken a rule to land a feature faster. The cost
compounds, and archcheck exists to make that cost visible.

## 8. Git safety

- Never commit to `main` without explicit confirmation from the user.
- Never delete a file or run a destructive git command — `push`, `reset --hard`, `branch -D`,
  `checkout --`, `clean -f` — without confirmation.
- When asked to "fix" or "clean up", stop and confirm the scope before you do anything destructive.
- Approval for one destructive action is not approval for the next. Confirm each time.

## 9. Plan against implementation

When the user asks you to update, refine, or revise a plan document, edit **only** the plan file.
Do not start implementing what the plan describes. Wait for an explicit "now implement".

`plan/` is gitignored in this repository. Do not create a worktree for a plan-only edit.

## 10. Verify before you claim

Re-run `bun run check` before you report a task complete. Do not claim "tests pass" or "lint is
clean" from memory.

When you review a report from a sub-agent, verify each claimed bug against the source before you
act on it. Sub-agent reviews have hallucinated bugs.

## 11. The main session orchestrates; sub-agents execute

The main session does not write or edit files. Every code or doc change — a one-line typo, a single
rename — is delegated to a sub-agent through the Agent tool. The main session understands the
request, drafts a self-contained brief, reviews the result against that brief, and reports.

- **Applies to:** `Edit`, `Write`, `MultiEdit`, and any Bash command that mutates the repository —
  a git command that changes state, `mv`, `rm`, a package install, code generation that writes
  files.
- **Does not apply to:** read-only inspection (`Read`, `Grep`, `Glob`, and `ls` / `cat` / `find` /
  `git status` / `git diff` / `git log` through Bash) and read-only verification — `bun run check`,
  `bun test`, `bunx tsc --noEmit` do not mutate source.
- **Exception:** `AGENTS.md`, `CLAUDE.md` and other meta files that define the operating rules may
  be edited in the main session, because they govern the orchestration loop itself.

Why: the main session's context fills with conversation, and a sub-agent gets clean, scoped context
for the actual change. A mistake stays inside the sub-agent instead of polluting the main session's
understanding of the codebase.

## 12. Cite what enforces a guarantee

A comment or a doc sentence that asserts a guarantee — "X is refused", "Y is validated", "Z never
happens" — names the file and symbol that enforces it, or the test that pins it. Add a line number
only when the symbol alone would not find it, and expect a line number to drift.

---

# Rules this repository learned the hard way

Each of these is here because it already failed once. The failing case is named.

## 13. A capability list is a promise. Make it true.

`Probe.handles` declares which rule kinds a probe evaluates. The graph probe once declared
`['layers', 'forbidden', 'encapsulation']` and evaluated two of them. A consumer who declared a
`forbidden` rule got `skipped: []`, `ok: true`, "nothing to fix", and the rule counted as
deterministic coverage. A declared rule, never checked, reported as compliance.

`tests/seams.test.ts` now pins the invariant: **the kinds probes handle are exactly the kinds that
have a contract type**, on both sides. Extend that test when you add a seam.

## 14. A check that matches nothing looks exactly like compliance

This is the failure mode the whole project exists to prevent, and it is the easiest one to
reintroduce.

- Every `error`-severity rule needs a fixture that it catches. Enforced by
  `every-error-rule-has-a-fixture`, and proven by `tests/fixtures.test.ts`, which asserts each
  fixture is caught by **exactly** its own rule.
- A new gate needs a test that shows it failing. A gate nobody has seen fail is a gate nobody
  should trust — see `tests/gates.test.ts`.
- If you fix a false positive, check that the fixture for that rule still fires. Fixing the
  `empty-catch` false positive silently stopped its fixture from firing; `src/probes/lint.test.ts`
  now asserts all nine of the lint fixture's rules have something to find.

## 15. The gates cannot see a packaging bug. Verify the published package.

Three real bugs were invisible to `bun run check` and visible only from a packed tarball installed
into an empty project:

- the binary did nothing and exited `0`, because the entry guard tested `process.argv[1]`, which is
  the `node_modules/.bin` symlink;
- `typescript@7` broke everything with an opaque error, because the peer range admitted it;
- `init` degraded silently when it could not read the module graph.

Before you change the entry point, `package.json`, the peer range, or anything under `dist`:

```bash
bun run build && npm pack --pack-destination /tmp
mkdir -p /tmp/consumer && cd /tmp/consumer && npm init -y
npm install /tmp/archcheck-<version>.tgz typescript@^5.9
npx archcheck --version && npx archcheck init && npx archcheck
```

`.github/workflows/publish.yml` does this too, and it refuses to publish if it fails.

## 16. Evidence feeds the identity hash. Keep configuration out of it.

`identity = sha256(ruleId + canonicalJson(evidence))`, computed in
`src/normalize/identity.ts`. It holds no line number and no absolute path, which is what lets the
baseline survive moved code.

Never put rule configuration into `evidence`. An allow-list that grows an unrelated entry would
change the hash and silently invalidate every baseline entry it touches. Per-finding wording goes
through `ContractType.refine`, and the rule set reaches `explain` through `ExplainCtx`.

## 17. No silent failure. A degraded result says so.

Every boundary failure is a typed error, a recorded `Skip` with a reason, or a printed warning.

- `RunResult.skipped` is always present, even when empty, so an agent can tell "clean" from "did
  not run".
- `init` exits `2` and says so when it cannot read the graph, because an empty `mayImport` list
  looks like a working manifest.
- A judgement rule promoted to `error` loads and **warns**, through `ContractType.warn`.

## 18. Exit codes are an API

`0` clean · `1` new violations · `2` the configuration is invalid · `3` emitted output is stale ·
`4` a baselined finding no longer reproduces. They are frozen, they are ordered in
`exitCodeFor` (`src/archcheck.ts`), and each sends an agent to a different file. Changing one is a
breaking change to every consumer.

## 19. The documentation is tested, because documentation can be wrong

`tests/readme.test.ts` runs every command `README.md` and the example's README promise, and asserts
the output they quote. It caught three false claims the day it was written.

If you change CLI output, a command name, or a generated file name, that suite fails. Fix the
document, not the assertion — unless the document was right and the code was wrong.

## 20. Two fixture suites, two different questions

| Suite | Question |
|---|---|
| `fixtures/repos/` | Does the **mechanism** work? Generic, one per contract kind. |
| `fixtures/rules/` | Does **this rule, as configured here**, catch anything? Repo-shaped. |

`examples/minimal-service/` is a third thing: executable documentation, kept honest by
`tests/examples.test.ts`. An example that rots is worse than no example.

## 21. A `*/` inside a block comment closes it

Writing a glob pattern such as `a/**` followed by `/b` inside a `/** ... */` comment ends the
comment early, and the file fails to parse. This has happened twice, in `src/util/glob.ts`. Describe
the pattern in words instead.

## 22. Know which files are generated

`generated/`, `RULES.md`'s fenced region, and `.archcheck/ids.json` are written by
`archcheck emit`. Never hand-edit them; `bun run check` fails with exit `3` if you do. Edit
`architecture.config.ts` and re-run `bun run src/cli/index.ts emit`.

`src/` must stay Node-compatible: no `Bun.*` and no `bun:*` import outside a `*.test.ts` file.
Enforced by `scripts/check-lint.sh`.

---

## The layout, in one table

| Path | What belongs there |
|---|---|
| `src/types.ts`, `result.ts`, `version.ts` | the kernel. Imports nothing, not even TypeScript |
| `src/util/` | pure helpers. Imports the kernel only |
| `src/graph/` | the module graph, read with the TypeScript compiler API. Reports facts, evaluates nothing |
| `src/contracts/` | one file per rule kind: `validate`, `emit`, `explain`, `refine`, `warn` |
| `src/registry/` | loads and validates the manifest. Knows a rule has a kind, never what a kind means |
| `src/probes/` | runs rules against the graph, the AST, or the filesystem. Returns evidence, never prose |
| `src/normalize/` | `RawFinding` + `Rule` → `Diagnostic`, and the identity hash |
| `src/report/` | terminal, json, sarif, verdict. Reads a `RunResult` and nothing else |
| `src/emit/` | fragments merged per sink, with a generated header |
| `src/baseline/`, `src/exceptions/` | debt, and policy. Different things, kept apart |
| `src/coverage/`, `src/fs/`, `src/init/`, `src/fixtures/` | leaves |
| `src/archcheck.ts` | **the composition root.** The only place the layers are wired together |
| `src/cli/` | parse arguments, call the facade, pick a reporter. Owns no behaviour |
| `*.test.ts`, `tests/` | the `test` layer. Exempt from the dependency law, because its job is to look at one |

Everything in that table is enforced by `architecture.config.ts`. If you disagree with a line,
change the manifest and say why — do not work around it.
