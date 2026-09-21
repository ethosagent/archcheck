// archcheck-fixture: verified-by "delete a fixture, and the run fails"
//
// You cannot break this rule with a file. You break it with a manifest that declares an
// error-severity rule and gives it no fixture. The README shows how to see it fail.
export const verifiedByATestInstead = true;
