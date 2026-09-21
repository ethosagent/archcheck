// archcheck-fixture: place-at src/util/Fixture_Violation.ts
//
// The deliberate violation is the FILENAME, not the contents: PascalCase with an underscore,
// where the rule wants camelCase or kebab-case. It imports nothing, so no other rule can fire.
export const deliberatelyBadlyNamedFile = true;
