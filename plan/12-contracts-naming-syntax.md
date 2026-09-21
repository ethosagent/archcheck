# 12 · Contracts: naming and banned-syntax

**Milestone** v0.2 · **Depends on** 05

> The two kinds that cover most of the lint tier in one pass.

## Why now

Thirty-one of the ninety-one rules land in these two kinds. Highest coverage per unit of work in
the whole plan set.

## In scope

- `naming`: `appliesTo`, `pattern` or `prefixes`, applied to files, exports or both
- `banned-syntax`: `appliesTo`, an AST selector, and a message
- Both emit lint fragments carrying the rule's statement

## Out of scope

- Auto-fixing anything — `remedy.autofix` stays false for both

## Design

**`naming` covers:** hook `use` prefix, twin factories, selectors, boolean prefixes, filenames,
test-id casing.

**`banned-syntax` covers:** no clock in rules, no computed dynamic import, no `console` outside
entry points, no inline suppression comment, no branching on a literal name, no empty catch.

**The inline-suppression ban is self-referential and deliberate.** Exceptions live in the manifest
with an owner and an expiry (plan 15). Making the inline escape hatch itself a violation is what
stops the manifest being bypassed.

**Both are evaluated over our own AST**, not delegated — we already have the program from plan 04,
so a second parse would be waste.

## Files

```
src/contracts/naming.ts
src/contracts/banned-syntax.ts
```

## Done when

- [ ] A naming rule catches a misnamed export and a misnamed file
- [ ] A banned selector catches its construct and reports the statement
- [ ] Both emit a lint fragment whose message is the statement

## Tests

- [ ] One fixture per rule family in each kind
- [ ] Selector with no match fails the fixture test — proving the rule is live
