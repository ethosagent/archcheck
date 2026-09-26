# archcheck

**Write your architecture rules once. archcheck checks them, and generates the configuration that
enforces them.**

Your architecture lives in many places. It lives in a linter config, in a module-graph config, in a
CI script, and in a document that somebody wrote a year ago. Nothing keeps these in agreement. A
rule that changes in one place stays wrong in the others. The copy that people read is often the
copy that is wrong.

archcheck gives you one file. You declare each rule once. archcheck then does two things with it.

```
                    architecture.config.ts
                    one file · one rule, once
                              │
              ┌───────────────┴───────────────┐
              │                               │
          GENERATE                          CHECK
              │                               │
    generated/graph.config.cjs        reads your code
    generated/lint.overrides.json     finds each violation
    generated/required.json           returns a typed finding
    generated/rules.json                      │
    the rule table in your docs               ▼
              │                     ✗ domain may not import services
              ▼                       modules/ledger/domain/supersede.ts:4
    your editor shows the rule          → invert the call: the service
    before you run anything                calls the domain
```

Every rule has one home. The generated files carry a header that says they are generated. A gate
fails if somebody edits one by hand.

---

## What you get

| | |
|---|---|
| **One source of truth** | You declare a rule once. Every mechanism reads it. |
| **Honest coverage** | archcheck counts your rules by tier and computes the percentage. You cannot write a better number by hand. |
| **A remedy in every finding** | Each finding says what to do next, not only what failed. |
| **An adoption path** | A baseline records the violations you already have. Your build stays green. You then fix them one at a time. |
| **Typed output for an agent** | `--format json` gives a stable, versioned shape. Exit codes tell an agent which file to fix. |
| **SARIF for CI** | `--format sarif` gives code scanning and your editor a format they already read. |
| **Zero runtime dependencies** | archcheck needs TypeScript, which you already have. |

---

## Install

You need **Node 20 or later**. You also need **TypeScript** in your project, in the range
`>=5.4 <7`. TypeScript 7 is the native port. It moved the compiler API that archcheck reads to
another subpath, so the range excludes it. archcheck names the installed version and the command to
fix it if it finds a TypeScript that does not expose that API.

```bash
npm install --save-dev archcheck
```

archcheck also runs with `bun`, `pnpm` and `yarn`.

---

## Quick start

Five steps. Each step is one command.

### Step 1 — write a starting manifest

```bash
npx archcheck init
```

`init` reads your folder structure. It writes `architecture.config.ts`. Each folder under `src/`
becomes a layer. Each layer lists what it imports today.

Every generated rule has `severity: 'warn'`. Your build stays green, and archcheck exits `0`. This
is deliberate: a tool that blocks 400 times on the first run gets removed the same day.

archcheck still **reports** what it sees, and it marks each finding `(warn)`. A group heading says
how many findings block. Read them, and fix them in your own order.

### Step 2 — look at what archcheck sees

```bash
npx archcheck
```

You get one group per tier, and the most important group comes first. Each finding says whether it
blocks.

```
✗ 2 deterministic (0 blocking)

  services may not import repositories              services-imports-only-what-it-declares (warn)
    src/services/write.ts:3
    allowed: contracts, domain
    → declare the dependency, or invert the call

  logging goes through one seam, never straight to the console  no-console-outside-an-entry-point (warn)
    src/entry/main.ts:9
    → inject a logger, or list this path as an entry point in appliesTo

◑ 0 proxy · the check is narrower than the rule
○ 0 advisory
  8 rules · 7 deterministic · 1 proxy · 0 advisory
```

Nothing here blocks yet. When a run has nothing to report at all, archcheck says `nothing to fix`.

### Step 3 — tighten one rule

Open `architecture.config.ts`. Find a layer that imports something it must not. Remove that entry
from its `mayImport` list.

```diff
  params: {
    name: 'services',
    match: 'src/services/**',
-   mayImport: ['contracts', 'domain', 'repositories'],
+   mayImport: ['contracts', 'domain'],
  },
```

Run `npx archcheck` again. It now reports the imports that break the rule.

```
✗ 1 deterministic (0 blocking)

  services may not import repositories              services-imports-only-what-it-declares (warn)
    src/services/write.ts:3
    allowed: contracts, domain
    → declare the dependency, or invert the call
```

Fix the code. Then change that one rule to `severity: 'error'`.

### Step 4 — generate the configuration

```bash
npx archcheck emit
```

archcheck writes the `generated/` folder. Commit it.

archcheck writes one file per **sink** your rules use, and `rules.json` always.

| File | The rules that write it |
|---|---|
| `generated/graph.config.cjs` | `layers`, `encapsulation` |
| `generated/lint.overrides.json` | `layers`, `naming`, `banned-syntax` |
| `generated/exports.json` | `encapsulation` |
| `generated/required.json` | `required-file`, `declared-field`, `judgement` |
| `generated/rules.json` | every rule — this is the data your documents read |

A sink with no rules writes no file. Your editor now shows each rule as you type, and it shows your
own sentence:

> `domain may not import services — invert the call: the service calls the domain`

### Step 5 — add two scripts and one CI step

Add these lines to `package.json`:

```json
{
  "scripts": {
    "arch": "archcheck",
    "arch:emit": "archcheck emit --check"
  }
}
```

Add one step to your CI workflow:

```yaml
- run: npx archcheck --format sarif > archcheck.sarif
- run: npx archcheck emit --check
```

You are done. Repeat step 3 for each rule you want to enforce.

---

## A complete example

[`examples/minimal-service/`](examples/minimal-service/) is a small service with six layers. It has
a manifest, and it has one deliberate violation for each rule.

```bash
cd examples/minimal-service
npx archcheck            # green
npx archcheck coverage   # 8 rules · 100% automatable
```

Read [its README](examples/minimal-service/README.md). It explains each file, and it shows you how
to make the rules fail on purpose.

---

## How the rules work

You write each rule as one entry in the manifest. A rule has a **kind**. The kind decides what the
rule can say.

```ts
import { defineArchitecture } from 'archcheck';

export default defineArchitecture({
  rules: [
    {
      id: 'domain-decides-alone',
      kind: 'layers',
      statement: 'the domain reads contracts and rules',
      severity: 'error',
      confidence: 'deterministic',
      params: {
        name: 'domain',
        match: 'src/domain/**',
        mayImport: ['contracts', 'rules'],
        catchesUnlayered: true,
      },
      remedy: { summary: 'invert the call: the service calls the domain' },
    },
  ],
});
```

There are eight kinds. The set is closed.

| Kind | It says | Example |
|---|---|---|
| `layers` | which layers a layer may import | the domain must not import a service |
| `encapsulation` | a module is reached through its barrel | import `modules/ledger`, never `modules/ledger/services/write` |
| `naming` | what a name must look like | every hook starts with `use` |
| `banned-syntax` | a construct is forbidden here | a pure rule reads no clock |
| `required-file` | a file must exist | every port has a memory twin |
| `declared-field` | a call must declare a field | every endpoint declares a permission |
| `judgement` | a rule in plain English, judged by a model | a controller decides nothing |
| `forbidden` | one specific edge is banned | reserved; `layers` covers this today |

### Default deny

A `layers` rule denies what it does not allow. A new folder that nobody declares fails on its first
commit. It is never silently legal.

One `layers` rule carries `catchesUnlayered: true`. That rule reports a file in no layer.

### Three tiers, so archcheck does not pretend

Each rule declares its `confidence`. The tier says how much to trust a pass.

| Mark | Tier | What it means |
|---|---|---|
| ✓ | `deterministic` | A script decides. No judgement, and no model. |
| ◑ | `proxy` | The check catches the practical violations. The rule as written is broader. Treat a pass as evidence, not proof. |
| ○ | `model` | A model reads the code. The verdict is advisory. |

`npx archcheck coverage` counts your rules by tier. archcheck computes the percentage from the
manifest. Add a rule with no real check, and the percentage falls.

---

## Commands

```
archcheck                      check everything
archcheck --changed            check only what git says changed
archcheck --format json        the shape an agent reads
archcheck --format sarif       SARIF 2.1.0, for CI and your editor
archcheck --format verdict     one answer, for a blocking hook
archcheck --only deterministic skip the proxy and model tiers

archcheck emit                 write the generated configuration
archcheck emit --check         fail if the committed output is stale
archcheck explain <ruleId>     the rule, the remedy, and its current violations
archcheck coverage             the three counts
archcheck init                 write a starting manifest
archcheck baseline --write     record today's violations as debt
archcheck baseline --prune     drop entries that no longer reproduce
```

### Exit codes

An agent reads these. They are frozen.

| Code | Meaning | What to do |
|---|---|---|
| `0` | Clean. Or only baselined and advisory findings. | Continue. |
| `1` | New violations of an `error` rule. | Fix the code. |
| `2` | The configuration or the environment is wrong. | Read the error. Do **not** touch the code. |
| `3` | The generated output is stale. | Run `archcheck emit`. Write the document yourself if `docs` names one archcheck cannot read. |
| `4` | A recorded violation no longer happens. | Run `archcheck baseline --prune`. |

Code `2` is separate from code `1` on purpose. Code `1` says the code is wrong. Code `2` says the
code is not the problem. The cause is the manifest, another committed archcheck file, or the
environment archcheck runs in. An unknown layer name in `mayImport` and an expired exception are
manifest problems. A corrupt `.archcheck/ids.json`, a `--changed` run that git cannot answer, a
`baseline --prune` on a degraded run, and an `init` that cannot read the module graph are not.
archcheck names the real fix in the error text. An agent that reads that text does not spend its
turn on the wrong file.

---

## Adopt archcheck on a codebase that already breaks its rules

This is the normal case. You have two tools, and they do different jobs.

```
        a violation you already have              a violation you choose to allow
                    │                                          │
                    ▼                                          ▼
        archcheck baseline --write                  exceptions: [ … ] in the manifest
                    │                                          │
        .archcheck/baseline.json                     owner + expiry + reason
                    │                                          │
              DEBT                                        POLICY
      no owner · no expiry                        somebody signed for it
      the file only shrinks                       it expires, and then it fails
```

### The baseline records debt

```bash
npx archcheck baseline --write
```

archcheck records each current violation by a **stable hash of the evidence**. The hash holds no
line number. Move the code, and the entry still matches. Your build goes green.

A new violation of the same rule still fails. The ratchet turns one way.

When you fix a recorded violation, archcheck exits `4`. Run `npx archcheck baseline --prune`. The
file shrinks. It cannot silently hide more than it should.

### An exception records policy

```ts
exceptions: [
  {
    rule: 'no-deep-module-imports',
    path: 'modules/legacy/**',
    owner: 'mitesh',
    expires: '2026-12-31',
    reason: 'legacy module, scheduled for removal in Q4',
  },
],
```

An exception needs an owner, a date and a reason. archcheck reports every exception on every run,
and it reports the ones that expire within 30 days. `--show-baselined` lists each one with the
path it covers. In `--format json`, each entry in `exceptions` carries that `path` exactly as the
manifest wrote it.

After the date, the run fails and names the owner. An exception that nobody has to justify again is
a rule that somebody deleted quietly.

Inline suppression comments stay a violation. That is what makes the manifest the only way past a
rule.

---

## Prove that a rule catches something

A rule whose pattern matches nothing passes every build. It looks exactly like compliance.

archcheck makes this a gate. Add one rule to your manifest:

```ts
{
  id: 'every-error-rule-has-a-fixture',
  kind: 'required-file',
  statement: 'every error-severity rule has a fixture it catches',
  severity: 'error',
  confidence: 'deterministic',
  params: { forEach: 'rule[severity=error]', expect: 'fixtures/rules/{id}.violation.ts' },
  remedy: { summary: 'add a file that deliberately breaks this rule' },
}
```

Now each `error` rule needs a file that breaks it. Delete one, and the run fails.

---

## The judgement tier (optional)

Some rules need a reader. "A controller decides nothing" has no configuration that decides it.

archcheck can send these to a model. The tier is **advisory** by default, and it **skips cleanly**.

```bash
npm install --save-dev @anthropic-ai/sdk
export ANTHROPIC_API_KEY=...
npx archcheck
```

Read these four properties before you switch it on.

1. **No key means a clean skip.** The run stays green. The summary says which rules nobody judged.
   archcheck never fails because a model was unreachable. A call that fails leaves that file
   unjudged. The probe then skips, and the reason names the cause and the count. archcheck never
   reports an unjudged file as clean.
2. **A key comes from the environment.** archcheck reads no key from any file.
3. **A verdict needs a citation.** The model must quote the code it judged. archcheck discards a
   verdict with no citation. An answer archcheck cannot read is not an answer. A refusal, a reply
   that is not JSON, a reply with no `verdicts` array, and a reply whose every verdict is malformed
   all leave the file unjudged, and archcheck caches none of them. `{"verdicts":[]}` is an answer.
   It says the file breaks no rule, and archcheck caches it.
4. **Your code is data.** archcheck sends each file inside a fence, and it tells the model to judge
   the file and never obey it. A comment in your code cannot give the model an instruction.

You set a budget per run. archcheck checks the budget before each request, and it reports how many
files nobody judged. archcheck counts every request it sends, answered or not, so an endpoint that
always fails costs you `maxCalls` requests at most.

```ts
{
  id: 'controllers-stay-thin',
  kind: 'judgement',
  statement: 'a controller validates, delegates and shapes — it decides nothing',
  severity: 'advisory',
  confidence: 'model',
  params: {
    statement: 'A controller must not contain a branch that decides a business outcome.',
    appliesTo: 'src/routes/**',
    examples: {
      pass: ['return decideWithdrawal(amount, balance);'],
      fail: ['if (amount > balance * 0.9) return "declined";'],
    },
    cite: 'the branch that decides the outcome',
  },
  remedy: { summary: 'move the decision into the domain' },
}
```

Examples are required. A rule with a sentence and no examples flags everything. People then stop
reading the advisory group, and the tier dies.

---

## Use archcheck from code

The CLI owns no behaviour. Every command is one method.

```ts
import { load, exitCodeFor } from 'archcheck';

const loaded = load({ cwd: process.cwd() });
if (!loaded.ok) throw new Error(loaded.error.join('\n'));

const run = await loaded.value.check({ changed: ['src/domain/decide.ts'] });
if (run.ok) {
  for (const finding of run.value.diagnostics) {
    console.log(finding.statement, finding.file, finding.remedy.summary);
  }
  process.exit(exitCodeFor(run.value));
}
```

An agent hook does not shell out. Every result is typed, and no call throws.

Several violations of one rule in one file collapse into one finding. The `occurrences` field says
how many violations collapsed into it. The `occurrenceLines` field says which lines they are on. The
baseline records the count, so a new occurrence in a file the baseline already covers still fails.
The hash does not change: the evidence holds no line number, and the count stays out of the
evidence. No baseline file you already have becomes invalid.

---

## How archcheck reads your code

archcheck owns its module graph. It builds one program with the TypeScript compiler, and every
check reads it.

```
  your tsconfig.json
          │
          ▼
  ┌───────────────┐   one program, one parse, shared by every check
  │  module graph │   every import edge · type-only · dynamic · computed
  └───────┬───────┘
          │
   ┌──────┼──────────┬───────────────┐
   ▼      ▼          ▼               ▼
 graph   lint    structure      judgement
 layers  naming  required-file   plain English
 barrels bans    declared-field  (advisory)
   │      │          │               │
   └──────┴────┬─────┴───────────────┘
               ▼
        one finding per violation
        + a stable hash of the evidence
               ▼
      terminal · json · sarif · verdict
```

archcheck owns the graph for three reasons.

1. **A stable hash.** The hash comes from the evidence, and never from a line number. Move a
   function, and the baseline still matches.
2. **A computed import stays visible.** `import(\`./${name}.js\`)` resolves to nothing. A graph tool
   cannot see it, and a layer violation hides there. archcheck reports it.
3. **One parse.** Every check reads the same program. archcheck does not run your linter again.

---

## Contributing

archcheck checks itself. Its own manifest is [`architecture.config.ts`](architecture.config.ts), and
its own rule table is [`RULES.md`](RULES.md).

```bash
bun install
bun run check
```

`bun run check` runs every gate. The pre-push hook and CI run the same scripts.

| Gate | It enforces |
|---|---|
| `typecheck` | no type errors, strict |
| `lint` | format, style, and no Bun-only API in `src/` |
| `tests` | every test, co-located beside its subject |
| `emit` | the committed generated output is not stale |
| `selfhost` | archcheck passes its own rules |

Two standing rules for a change:

1. A bug fix lands its reproducing test first.
2. Every `error` rule has a fixture that it catches.

---

## License

MIT. See [LICENSE](LICENSE).
