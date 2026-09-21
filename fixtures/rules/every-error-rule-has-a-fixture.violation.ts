// archcheck-fixture: verified-by "the fixture obligation fires when a fixture is missing"
//
// This rule cannot be violated by PLACING a file: the violation is a manifest that declares an
// error-severity rule with no fixture, which is a property of the manifest rather than of any
// file in the tree. The named test builds exactly that manifest and asserts the rule fires.
//
// This is the only fixture in the suite that is not proven by placement, and the harness asserts
// that — a second one would mean the escape hatch had started spreading.
export const verifiedByATestInstead = true;
