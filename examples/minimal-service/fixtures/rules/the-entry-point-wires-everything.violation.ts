// archcheck-fixture: place-at src/fixtureUndeclared/thing.ts
//
// A folder that no layer declares. This rule carries catchesUnlayered, so it reports the file.
// A new folder fails on its first commit. It is never silently legal.
export const undeclared = true;
