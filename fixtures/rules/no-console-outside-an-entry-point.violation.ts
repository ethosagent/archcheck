// archcheck-fixture: place-at src/util/fixtureConsole.ts
//
// Logging straight to the console outside an entry point. One logger seam, or the package stops
// being embeddable.
export function shout(message: string): void {
  console.log(message);
}
