# 01 · Scaffolding

**Milestone** v0.1 · **Depends on** —

> An empty package that builds, lints, type-checks and runs its own gates in CI.

## Why now

Nothing can be verified until the gates exist. This is the only plan with no feature in it, and it
is the one that decides whether every later plan is cheap or expensive.

## In scope

- Bun workspace-ready single package, publishable to npm as `archcheck`
- TypeScript strict, `typescript` as a **peerDependency** (consumers already have it)
- Biome for lint + format, one config
- `scripts/check-*.sh` fanned out by `run-checks.sh` — local == hook == CI
- lefthook pre-commit and pre-push
- GitHub Actions running the identical scripts
- `fixtures/` directory with a placeholder synthetic repo

## Out of scope

- Any archcheck functionality
- Monorepo layout — this is one package; it moves into `packages/archcheck/` later unchanged

## Design

**Runtime target.** Develop and run with Bun. **`src/` uses no Bun-only API** — no `Bun.file`, no
`Bun.$`, no `bun:*` imports. Node-compatible output so anyone can install it. Bun is the dev
runner, not the deployment target. A lint rule enforces this from day one.

**Package shape.**

```jsonc
{
  "name": "archcheck",
  "type": "module",
  "bin": { "archcheck": "./dist/cli.js" },
  "exports": { ".": "./dist/index.js" },
  "peerDependencies": { "typescript": ">=5.4" },
  "engines": { "node": ">=20" }
}
```

**Gates from day one**, even with nothing to check — each skips cleanly when empty but fails under
CI if its subject exists and is broken:

| Script | Enforces |
|---|---|
| `check-typecheck.sh` | `tsc --noEmit`, strict |
| `check-lint.sh` | Biome, plus the no-Bun-API rule |
| `check-tests.sh` | `bun test` |
| `check-selfhost.sh` | archcheck checks archcheck — **stubbed until v0.2** |
| `check-emit.sh` | generated output is not stale — **stubbed until 09** |

**Self-hosting is the point.** From v0.2, archcheck runs against its own source. If it cannot hold
its own dependency law it has no business holding anyone else's.

## Files

```
archcheck/
  src/index.ts            # empty public surface
  src/cli.ts              # prints version, exits 0
  package.json  tsconfig.json  biome.json  lefthook.yml
  scripts/run-checks.sh  scripts/check-*.sh
  .github/workflows/ci.yml
  fixtures/.gitkeep
  tests/.gitkeep
```

## Done when

- [ ] `bun install && bun run check` is green on an empty tree
- [ ] `npx archcheck --version` prints a version
- [ ] CI runs the same scripts and is green
- [ ] A deliberate Bun-API import in `src/` fails lint

## Tests

- [ ] `check-lint.sh` fails on a planted `Bun.file` call in `src/`
- [ ] `tsc --noEmit` passes with `strict: true`
