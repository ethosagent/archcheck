# 04 · Graph reader

**Milestone** v0.1 · **Depends on** 02

> Our own module graph, read with the TypeScript compiler API. The core asset everything else reads.

## Why now

Decided over wrapping an existing tool. Three reasons, all load-bearing: line-independent identity
hashes, type-aware layer matching, and one parse shared by every probe.

## In scope

- A `Program` built from the consumer's tsconfig
- Every import edge with its AST node — resolved specifier, kind, and whether type-only
- Symbol resolution good enough to answer "does this implement interface X"
- A content-hash cache so an unchanged file is not re-parsed
- Dynamic-import detection, including the computed case we ban

## Out of scope

- Cycle detection — later, if a rule needs it
- Orphan detection — not a rule we have
- Any rule evaluation; this layer only reports facts

## Design

**Use the compiler API directly**, not a wrapper library. One peer dependency we already require,
no second abstraction to learn, full access to the checker.

**The edge is the unit.**

```ts
type Edge = {
  from: string;            // resolved absolute path
  to: string;              // resolved absolute path, or the bare specifier if external
  external: boolean;
  typeOnly: boolean;       // `import type` — some rules care, most do not
  dynamic: 'none' | 'literal' | 'computed';
  node: ts.Node;           // for position AND for the identity hash
};
```

**`computed` is why we own this.** A dynamic import with a non-literal specifier resolves to
nothing — it is invisible to a graph tool and it is exactly how a layer violation hides. We detect
and report it, so the `banned-syntax` rule can forbid it and the graph stays complete.

**Type-aware matching.** A layer's `match` accepts a path glob **or** `implements: 'PortName'`.
The second needs the type checker, which is the other reason we own the graph.

**Caching.** Key on `(tsconfig hash, file content hash)`. An unchanged file reuses its parsed
edges. This is where incremental runs actually pay off — not in skipping the graph, but in skipping
the parse.

## Files

```
src/graph/program.ts      # build from tsconfig
src/graph/edges.ts        # extract edges from a SourceFile
src/graph/match.ts        # layer matching: glob | implements
src/graph/cache.ts
src/graph/index.ts
```

## Done when

- [ ] Edges extracted for a fixture repo, including type-only and dynamic
- [ ] A computed dynamic import is reported with `dynamic: 'computed'`
- [ ] `implements:` matching resolves through the checker
- [ ] Second run on unchanged files hits the cache

## Tests

- [ ] Fixture: static, type-only, literal-dynamic and computed-dynamic imports
- [ ] Fixture: a class implementing a port, matched by `implements:`
- [ ] Cache hit asserted by counting parses
