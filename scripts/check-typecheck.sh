#!/usr/bin/env bash
# No type errors, strict, across src/, tests/ and the manifest.
set -euo pipefail
cd "$(dirname "$0")/.."
bunx tsc --noEmit -p tsconfig.json
echo "tsc --noEmit clean (strict)"
