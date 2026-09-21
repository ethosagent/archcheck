// archcheck-fixture: place-at src/rules/fixtureConsole.ts
//
// A write to the console outside the entry point.
export function shout(message: string): void {
  console.log(message);
}
