# Consumer fixtures — one deliberate violation per rule

These answer a different question from `fixtures/repos/`.

| Suite | Answers |
|---|---|
| `fixtures/repos/` | does the **mechanism** work? Generic, one per contract kind. |
| `fixtures/rules/` | does **this rule, as configured here**, catch anything? Repo-shaped. |

A rule whose pattern matches nothing passes every build and is indistinguishable from compliance.
That is what this suite exists to prevent, and `every-error-rule-has-a-fixture` makes it a gate
rather than discipline: every error-severity rule in `architecture.config.ts` must have a file here.

Each file opens with a placement directive read by `tests/fixtures.test.ts`:

```
// archcheck-fixture: place-at src/graph/leak.ts
// archcheck-fixture: append-to src/version.ts
// archcheck-fixture: verified-by <a test name>
```

The harness copies this repository to a scratch directory, places every fixture, runs archcheck
once, and asserts each fixture file is caught by **exactly its own rule** and no other. A fixture
that trips three rules is testing nothing in particular.
