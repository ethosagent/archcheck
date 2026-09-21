# 23 · Publish and adopt

**Milestone** v0.5 · **Depends on** 22

> Ship it to npm, then adopt it into World Engine wave 0.

## Why now

The package name is reserved from the first release, and adoption is the only real proof the design
works.

## In scope

- `archcheck` published from this directory
- README with the five-step integration
- `archcheck init` — write a starting manifest from the folder structure
- Adopt into World Engine wave 0 as item 0.3
- Move the package to `packages/archcheck/` if it goes in-tree

## Out of scope

- Docs site, marketing, a plugin ecosystem

## Design

**`init` arrives last, not first.** Earlier plans called it the nicest feature and the least
urgent — inference has nothing to read on a greenfield repo. By now archcheck has fixtures and a
self-host manifest to infer *from*, which is what makes it worth writing.

**Adoption sequence into World Engine:**

```
1. bun add -d archcheck
2. archcheck init              → layers inferred, everything at warn
3. archcheck emit              → configs + rules.json committed
4. two lines in package.json, one CI step
5. promote rules to error one at a time, each with its fixture
```

**Ship at v0.5, not before.** Before the ratchet and exceptions exist, adopting it anywhere with
existing code is impossible; before fixtures exist, the rules are unproven.

## Files

```
README.md
src/cli/init.ts
.github/workflows/publish.yml
```

## Done when

- [ ] `npm publish` succeeds and the package installs clean in an empty project
- [ ] `archcheck init` produces a loadable manifest
- [ ] World Engine wave 0 includes archcheck and is green

## Tests

- [ ] Install into a scratch project and run against it
- [ ] `init` output loads without edits
