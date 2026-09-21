#!/usr/bin/env bash
# Committed generated output is not stale.
#
# Skip-when-absent, fail-when-present: until plan 09 there is no emitter, so there is nothing
# to be stale. Once architecture.config.ts exists this gate is live, and under CI a missing
# emitter is a failure rather than a skip.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f architecture.config.ts ]; then
  if [ "${CI:-}" = "true" ] && [ -d generated ]; then
    echo "generated/ exists but architecture.config.ts does not — emit has no source"; exit 1
  fi
  echo "SKIP no architecture.config.ts yet (plan 09/13)"; exit 0
fi

bun run src/cli/index.ts emit --check
