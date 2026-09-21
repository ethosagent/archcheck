// archcheck-fixture: place-at src/util/fixtureComputedImport.ts
//
// A dynamic import whose specifier is computed resolves to nothing, so it is invisible to a
// module-graph tool — which is exactly how a layer violation hides.
export async function reach(which: string): Promise<unknown> {
  return import(`./${which}.js`);
}
