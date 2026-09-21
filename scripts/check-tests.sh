#!/usr/bin/env bash
# Unit tests, co-located beside their subject, plus the end-to-end suite under tests/.
set -euo pipefail
cd "$(dirname "$0")/.."

count=$(find src tests -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" = "0" ]; then
  if [ "${CI:-}" = "true" ]; then echo "no tests found, and CI requires some"; exit 1; fi
  echo "SKIP no *.test.ts yet"; exit 0
fi
# --timeout is a deliberate configuration choice, not a workaround: a timeout too low for honest
# work is a misconfigured timeout, and bun's default of 5s is. Eight files under tests/ spawn real
# CLI subprocesses; the slowest honest test is ~2.4s locally and CI runs the suite ~3x slower
# (~50s local vs ~150s), which already puts two of them over 5s. 30s is that worst case plus
# headroom for a loaded shared runner. A genuinely hung test still fails — it just takes 30s to
# say so instead of 5s. The one test that does strictly more work (the published-CLI symlink test
# in tests/cli.test.ts, which may build dist/ on demand) carries its own longer per-test timeout.
bun test --timeout 30000 src tests
