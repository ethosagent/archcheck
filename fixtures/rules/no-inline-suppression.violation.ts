// archcheck-fixture: place-at src/util/fixtureSuppression.ts
//
// An inline suppression comment. Exceptions belong in the manifest with an owner and an expiry;
// making the inline escape hatch itself a violation is what stops the manifest being bypassed.
// eslint-disable-next-line no-unused-vars
export const suppressed = 1;
