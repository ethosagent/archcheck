// archcheck-fixture: place-at src/util/fixtureEmptyCatch.ts
//
// A genuinely empty catch — no statements and no comment. A catch holding only a comment is an
// EXPLAINED silence, which the rule deliberately allows, so this fixture must not carry one.
export function swallow(risky: () => number): number {
  try {
    return risky();
  } catch {}
  return 0;
}
