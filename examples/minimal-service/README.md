# Example — a minimal service

This is a small service with six layers. It shows every part of archcheck in one place.

Run it:

```bash
npx archcheck            # green: nothing to fix
npx archcheck coverage   # 8 rules · 100% automatable
npx archcheck explain domain-decides-alone
```

---

## The layers

Each arrow points down. No arrow points back.

```
   entry        src/entry/main.ts          chooses every implementation · prints
     │                                      may import: anything
     ▼
  services      src/services/**            sequences the work · owns no decision
     │                                      may import: contracts, rules, domain
     ▼
   domain       src/domain/**              makes the decision
     │                                      may import: contracts, rules
     ├──────────────┐
     ▼              ▼
   rules        repositories               pure functions   ·   talks to the outside
     │              │                       may import: contracts (both)
     └──────┬───────┘
            ▼
        contracts   src/contracts/**       the shared vocabulary
                                            may import: nothing
```

`src/repositories/entryStore.ts` is the only file that keeps state. `src/entry/main.ts` is the only
file that writes to the console. Both facts are rules, and archcheck checks both.

---

## The files

| File | Layer | Why it is here |
|---|---|---|
| `src/contracts/types.ts` | contracts | The shared types. It imports nothing. |
| `src/rules/amount.ts` | rules | A pure function. No clock, and no I/O. |
| `src/domain/decide.ts` | domain | The decision. A second implementation could replace it. |
| `src/repositories/entryStore.ts` | repositories | The memory store. It talks to the outside world. |
| `src/services/record.ts` | services | The sequence of steps. It owns no decision. |
| `src/entry/main.ts` | entry | The composition root. It picks the store. |
| `architecture.config.ts` | — | Every rule, declared once. |
| `fixtures/rules/*.violation.ts` | — | One deliberate violation per rule. |

---

## Make a rule fail

Each command below breaks one rule. Run `npx archcheck` after each one, then undo it.

### Break the dependency law

Add this line to `src/repositories/entryStore.ts`:

```ts
import { decide } from '../domain/decide.js';
```

archcheck reports:

```
✗ 1 deterministic

  repositories may not import domain               repositories-read-contracts-only
    src/repositories/entryStore.ts:2
    allowed: contracts
    → take what you need as an argument from the service
```

### Add a folder that nobody declared

```bash
mkdir -p src/helpers && echo 'export const x = 1;' > src/helpers/thing.ts
npx archcheck
```

archcheck reports the file as unlayered. A new folder fails on its first commit. Declare a layer for
it, or move the file into a layer that exists.

### Write to the console outside the entry point

Add `console.log('hi');` to `src/domain/decide.ts`. archcheck reports it. Only `src/entry/**` may
reach the console.

### Delete a fixture

```bash
rm fixtures/rules/rules-are-pure.violation.ts
npx archcheck
```

archcheck reports that the rule has no fixture. Each `error` rule must have a file that breaks it. A
rule that catches nothing passes every build, and it looks exactly like compliance.

---

## Adopt the rules on code that already breaks them

Break a rule, then record it instead of fixing it:

```bash
echo "import { decide } from '../domain/decide.js';" >> src/repositories/entryStore.ts
npx archcheck                    # exit 1
npx archcheck baseline --write   # records the violation
npx archcheck                    # exit 0
```

Now move the import to a different line in the same file. Run `npx archcheck` again. It stays green:
archcheck keys the entry on the evidence, and never on the line number.

Now fix the code properly and run `npx archcheck`. It exits `4`, because a recorded violation no
longer happens. Run `npx archcheck baseline --prune`. It goes green.

---

## What to copy into your own project

1. Copy `architecture.config.ts`. Change the layer names and the paths.
2. Copy `fixtures/rules/`. Write one violation per rule you set to `error`.
3. Run `npx archcheck emit`, and commit the `generated/` folder.

Or start from your own folders instead:

```bash
npx archcheck init
```
