# 15 · Exceptions

**Milestone** v0.3 · **Depends on** 03, 14

> A deliberate, owned, expiring allowance — the only legitimate way past a rule.

## Why now

People will need exceptions. Designing the mechanism is how you stop inline comments spreading.

## In scope

- `exceptions[]` in the manifest: rule, path or identity, owner, expires, reason
- An expired exception **fails the run**
- Exceptions are reported in the summary, never silent
- Inline suppression comments remain a lint violation (plan 12)

## Out of scope

- Approval workflow — the reviewer of the manifest diff is the approval

## Design

```ts
exceptions: [
  { rule: 'no-deep-module-imports',
    path: 'modules/legacy/**',
    owner: 'mitesh',
    expires: '2026-12-31',
    reason: 'legacy module, scheduled for removal in Q4' },
]
```

**Expiry is enforced, not advisory.** Past the date the run fails with the owner named. An
exception that needs extending is a conversation, which is the point — an exception nobody has to
re-justify is just a rule that was quietly deleted.

**Always visible.** The terminal summary always prints the count of active exceptions and how many
expire within thirty days. Silent exceptions decay into permanent ones.

## Files

```
src/exceptions/apply.ts
src/exceptions/validate.ts
```

## Done when

- [ ] An exception suppresses its violation
- [ ] An expired exception fails the run and names the owner
- [ ] Active exceptions appear in the summary
- [ ] An exception with no owner or no expiry fails validation (exit 2)

## Tests

- [ ] Expiry boundary: the day before, the day of, the day after
