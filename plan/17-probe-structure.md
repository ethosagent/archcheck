# 17 · Probe: structure

**Milestone** v0.4 · **Depends on** 16

> Runs the filesystem and AST-shape rules.

## Why now

Last of the deterministic probes. After this every ✓ rule in the patterns document has a home.

## In scope

- `StructureProbe` for `required-file` and `declared-field`
- Filesystem reads through one injectable interface, so tests need no disk
- Registry iteration for the self-referential case

## Out of scope

- Watch mode

## Design

**Filesystem behind an interface.** `FileSystem` with `exists`, `read`, `glob`. The memory
implementation is what lets the whole suite run without touching disk — the same twin discipline
archcheck enforces on its consumers.

**Evidence must name the subject, not the checker.** A missing twin reports against the *port*
that lacks one, with the expected path. `file: 'src/contracts/ports/blob-store.ts'`, not the
directory that was searched.

## Files

```
src/probes/structure.ts
src/fs/types.ts
src/fs/node.ts
src/fs/memory.ts
```

## Done when

- [ ] Both structure kinds produce findings
- [ ] The whole probe suite runs against the memory filesystem
- [ ] Evidence points at the subject

## Tests

- [ ] Memory FS covers every structure test
- [ ] Node FS and memory FS produce identical findings for one fixture
