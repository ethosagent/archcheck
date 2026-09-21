#!/usr/bin/env bash
# Committed generated output is not stale.
#
# Live since plan 09/13. Exits 3 when the committed output no longer matches the manifest.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f architecture.config.ts ]; then
  echo "generated output has no source — archcheck needs its own architecture.config.ts"; exit 1
fi

bun run src/cli/index.ts emit --check
