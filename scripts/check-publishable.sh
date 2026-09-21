#!/usr/bin/env bash
# The tarball npm would publish actually contains every entry point package.json declares.
#
# AGENTS.md rule 15: the other gates cannot see the packaging path. dist/ is gitignored, so a
# clean clone has no dist/, `npm pack` there produced LICENSE + README.md + package.json and
# nothing else, and every declared entry point — bin, exports, main, types — pointed at a file
# that would not exist once installed. `bun run check` was green on that tree. This gate is what
# closes that hole; `prepublishOnly` in package.json is what stops the unbuilt publish itself.
#
# It builds first, so the gate is self-contained: its verdict is about this tree, not about
# whoever last ran `bun run build` by hand. That is the cost of one tsc run (~1s, incremental).
#
# Nothing here publishes and nothing here needs auth. `--dry-run` writes no .tgz, so the gate
# leaves no artifact in the repo; the listing goes to a temp file the trap removes.
# `--ignore-scripts` is a belt, not the braces. npm runs `prepare` for `npm pack`, and anything
# `prepare` prints to stdout lands in this listing ahead of the JSON and breaks the parse below.
# The flag alone was not enough: it held on npm 11 locally and the Linux CI runner ran `prepare`
# regardless, so the gate went red on a tree that was green here. The real guard is that
# `prepare` in package.json is silent — keep it that way, and keep this flag as well.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v npm >/dev/null 2>&1; then
  if [ "${CI:-}" = "true" ]; then
    echo "npm is not on PATH, and the publishable check is not optional under CI"; exit 1
  fi
  echo "SKIP npm not on PATH"; exit 0
fi

bun run build

# An explicit XXXXXX template, not `mktemp -t archcheck-pack`: GNU coreutils requires a
# template ending in at least three X's and fails "too few X's in template" on a bare
# prefix, while BSD mktemp on macOS accepts it — so the bare form was green locally and
# red on the Linux CI runner. This form works on both.
listing="$(mktemp "${TMPDIR:-/tmp}/archcheck-pack.XXXXXX")"
trap 'rm -f "$listing"' EXIT
npm pack --dry-run --json --ignore-scripts >"$listing"

node - "$listing" <<'JS'
const { readFileSync } = require('node:fs');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const packed = JSON.parse(readFileSync(process.argv[2], 'utf8'))[0];
const files = new Set(packed.files.map((f) => f.path));

// Derived from the manifest, never hardcoded — a hardcoded list would drift the moment someone
// adds a second bin or an exports subpath, and a gate that checks yesterday's paths is the
// "check that matches nothing" of AGENTS.md rule 14. bin and exports both nest (subpaths,
// conditions, fallback arrays), so walk every value and keep the relative ones.
const declared = new Set();
const walk = (value) => {
  if (typeof value === 'string') {
    if (value.startsWith('.')) declared.add(value.replace(/^\.\//, ''));
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) walk(child);
  }
};
walk(pkg.bin);
walk(pkg.exports);
walk(pkg.main);
walk(pkg.types);

const missing = [...declared].filter((path) => !files.has(path));
const built = [...files].filter((path) => path.startsWith('dist/'));

if (missing.length > 0) {
  console.error('the tarball npm would publish is missing declared entry point(s):');
  for (const path of missing) console.error(`  ${path}`);
  console.error('  → package.json declares these in bin/exports/main/types, so an install');
  console.error('    resolves them and fails. Run `bun run build`, and check the "files" field.');
  process.exit(1);
}

if (built.length === 0) {
  console.error('the tarball contains no dist/ file at all — it would install nothing runnable');
  process.exit(1);
}

console.log(`npm pack lists ${files.size} files, ${built.length} under dist/`);
console.log(`every declared entry point is packed: ${[...declared].sort().join(', ')}`);
JS
