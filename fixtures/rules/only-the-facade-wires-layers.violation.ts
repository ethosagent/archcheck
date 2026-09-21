// archcheck-fixture: place-at src/fixtureUndeclared/thing.ts
//
// A folder nobody declared. This rule carries `catchesUnlayered`, so it is the rule that fires —
// and the property being proven is that a new folder fails on its FIRST commit rather than being
// silently legal.
export const undeclared = true;
