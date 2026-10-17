import { expect, test } from 'bun:test';
import { isQualified, qualifiedMatches } from './qualifiedTarget.js';

const exec = 'node:child_process#exec';

test('a qualified target is told apart from a dotted one', () => {
  expect(isQualified(exec)).toBe(true);
  expect(isQualified('console.log')).toBe(false);
});

test('an exact qualified target matches itself and nothing else', () => {
  expect(qualifiedMatches(exec, exec)).toBe(true);
  expect(qualifiedMatches(exec, 'node:child_process#spawn')).toBe(false);
  expect(qualifiedMatches(exec, 'node:fs#exec')).toBe(false);
});

test('a trailing star matches on either half, and a dotted target never matches', () => {
  expect(qualifiedMatches('node:child_process#*', exec)).toBe(true);
  expect(qualifiedMatches('node:*#exec', exec)).toBe(true);
  expect(qualifiedMatches('globalThis#console.*', 'globalThis#console.log')).toBe(true);
  expect(qualifiedMatches('globalThis#console.*', 'globalThis#process.env')).toBe(false);
  expect(qualifiedMatches('console.log', 'globalThis#console.log')).toBe(false);
});
