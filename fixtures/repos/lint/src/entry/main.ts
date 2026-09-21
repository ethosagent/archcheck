// An entry point. It is allowed to reach the console, which is why the rule's appliesTo
// excludes this folder rather than the rule being softened.
export function start(): void {
  console.log('started');
}
