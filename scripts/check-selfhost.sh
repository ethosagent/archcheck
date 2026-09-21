#!/usr/bin/env bash
# archcheck checks archcheck.
#
# If it cannot hold its own dependency law it has no business holding anyone else's.
# Skip-when-absent, fail-when-present: stubbed until plan 13 lands the manifest.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f architecture.config.ts ]; then
  if [ "${CI:-}" = "true" ] && [ -f src/archcheck.ts ]; then
    echo "the facade exists but archcheck has no manifest of its own — self-host is not optional"
    exit 1
  fi
  echo "SKIP no architecture.config.ts yet (plan 13)"; exit 0
fi

bun run src/cli/index.ts --only deterministic
