import { expect, test } from 'bun:test';
import { externalReason, normalizeSpecifier } from './externals.js';

test('a built-in reads the same with or without the node prefix', () => {
  expect(normalizeSpecifier('fs')).toBe('node:fs');
  expect(normalizeSpecifier('node:fs')).toBe('node:fs');
  expect(normalizeSpecifier('fs/promises')).toBe('node:fs/promises');
  expect(normalizeSpecifier('react')).toBe('react');
});

test('a deny list denies, and node:* catches the unprefixed form', () => {
  expect(externalReason({ deny: ['react'] }, 'react')).toBe('denied');
  expect(externalReason({ deny: ['node:*'] }, 'fs')).toBe('denied');
  expect(externalReason({ deny: ['react'] }, 'zod')).toBeUndefined();
});

test('an allow list is default deny, and an empty policy has no opinion', () => {
  expect(externalReason({ allow: ['zod'] }, 'zod')).toBeUndefined();
  expect(externalReason({ allow: ['zod'] }, 'react')).toBe('unlisted');
  expect(externalReason({}, 'react')).toBeUndefined();
});
