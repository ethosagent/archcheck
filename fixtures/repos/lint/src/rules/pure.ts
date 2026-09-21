// Clean: no clock, no literal branch, no empty catch, no suppression, no computed import.
export function assertPositive(cents: number): void {
  if (cents <= 0) throw new Error('an amount must be positive');
}
