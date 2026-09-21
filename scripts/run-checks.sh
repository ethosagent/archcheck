#!/usr/bin/env bash
# The one runner. Every gate is a scripts/check-*.sh; this fans them out and reports ALL
# failures rather than stopping at the first, so one run surfaces everything to fix.
# The local command, the pre-push hook and CI run these same scripts — local == CI by
# construction, not by discipline.
set -uo pipefail
cd "$(dirname "$0")/.."

GATES=(
  check-typecheck.sh
  check-lint.sh
  check-tests.sh
  check-emit.sh
  check-selfhost.sh
)

FAILED=()
PASSED=()
SKIPPED=()

for gate in "${GATES[@]}"; do
  name="${gate#check-}"; name="${name%.sh}"
  printf '\n\033[1m── %s\033[0m\n' "$name"
  out="$(bash "scripts/$gate" 2>&1)"; code=$?
  case "$code" in
    0)  if grep -q '^SKIP ' <<<"$out"; then SKIPPED+=("$name"); else PASSED+=("$name"); fi
        printf '%s\n' "$out" | sed 's/^/  /' ;;
    *)  FAILED+=("$name"); printf '%s\n' "$out" | sed 's/^/  /' ;;
  esac
done

printf '\n\033[1m── summary\033[0m\n'
for n in "${PASSED[@]:-}";  do [ -n "$n" ] && printf '  \033[32m✓\033[0m %s\n' "$n"; done
for n in "${SKIPPED[@]:-}"; do [ -n "$n" ] && printf '  \033[33m-\033[0m %s (skipped)\n' "$n"; done
for n in "${FAILED[@]:-}";  do [ -n "$n" ] && printf '  \033[31m✗\033[0m %s\n' "$n"; done

if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '\n\033[31m%d gate(s) failed\033[0m\n' "${#FAILED[@]}"
  exit 1
fi
printf '\n\033[32mall gates green\033[0m\n'
