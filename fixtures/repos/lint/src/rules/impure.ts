// Every planted violation in this file is deliberate, one per banned construct.

export function staleness(): number {
  // no clock in a rule — member-access Date.now
  return Date.now();
}

export function epoch(): Date {
  // no clock in a rule — new-expression Date
  return new Date();
}

export function byName(kind: string): boolean {
  // no branching on a literal name
  return kind === 'stock-market';
}

export function swallow(): void {
  try {
    staleness();
  } catch {
    // no empty catch
  }
}

// no inline suppression comment
// eslint-disable-next-line no-unused-vars
export const unused = 1;

export function shout(message: string): void {
  // no console outside an entry point
  console.warn(message);
}

export async function reach(which: string) {
  // no computed dynamic import
  return import(`./${which}.js`);
}
