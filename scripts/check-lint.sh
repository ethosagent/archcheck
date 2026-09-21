#!/usr/bin/env bash
# Biome (format + lint, including noConsole outside an entry point), plus the no-Bun-API rule.
#
# The Bun rule lives here rather than in Biome because it is a module-and-global ban that Biome
# has no rule for, and adding a plugin for one grep is not worth the dependency. src/ must stay
# Node-compatible: Bun is the dev runner, not the deployment target.
#
# It runs FIRST, before the style pass: it is an architecture rule, and a stray quote style
# must not hide it behind unrelated diagnostics.
#
# Co-located *.test.ts files are exempt: they run under Bun by definition and tsconfig.build.json
# excludes them from the published dist, so they are not part of the Node-compatible surface.
set -euo pipefail
cd "$(dirname "$0")/.."

BUN_API='(\bBun\.[A-Za-z_]|from[[:space:]]+[\"'"'"']bun:|require\([\"'"'"']bun:)'
if hits=$(grep -rnE "$BUN_API" src --include='*.ts' --exclude='*.test.ts' 2>/dev/null); then
  echo "Bun-only API in src/ — src must stay Node-compatible:"
  printf '%s\n' "$hits" | sed 's/^/  /'
  echo "  → use a node: builtin instead. Bun is the dev runner, not the target."
  exit 1
fi
echo "no Bun-only API in src/"

bunx biome check .
echo "biome clean"
