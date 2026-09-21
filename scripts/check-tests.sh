#!/usr/bin/env bash
# Unit tests, co-located beside their subject, plus the end-to-end suite under tests/.
set -euo pipefail
cd "$(dirname "$0")/.."

count=$(find src tests -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" = "0" ]; then
  if [ "${CI:-}" = "true" ]; then echo "no tests found, and CI requires some"; exit 1; fi
  echo "SKIP no *.test.ts yet"; exit 0
fi
bun test src tests
