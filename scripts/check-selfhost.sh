#!/usr/bin/env bash
# archcheck checks archcheck.
#
# If it cannot hold its own dependency law it has no business holding anyone else's.
# Live since plan 13. archcheck's own architecture.config.ts is the subject.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f architecture.config.ts ]; then
  echo "archcheck has no manifest of its own — self-host is not optional"
  exit 1
fi

# Every tier, not --only deterministic: the proxy tier is where this repo's own weakest checks
# live, and a gate that skips them is not evidence about them.
bun run src/cli/index.ts --no-color
