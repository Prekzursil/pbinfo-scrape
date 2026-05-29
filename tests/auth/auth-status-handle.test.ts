import { describe, expect, test } from 'vitest';

import { matchesConfiguredHandle } from '../../src/auth/auth-status.js';

describe('matchesConfiguredHandle', () => {
  test('returns true when no configured handle is required', () => {
    expect(matchesConfiguredHandle(undefined, 'someone')).toBe(true);
    expect(matchesConfiguredHandle('', 'someone')).toBe(true);
  });

  test('returns false when a candidate handle is missing but configured exists', () => {
    expect(matchesConfiguredHandle('alice', undefined)).toBe(false);
    expect(matchesConfiguredHandle('alice', '')).toBe(false);
  });

  test('returns false when one normalized handle ends up empty', () => {
    expect(matchesConfiguredHandle('   ', 'alice')).toBe(false);
    expect(matchesConfiguredHandle('alice', '   ')).toBe(false);
  });

  test('matches a candidate that wraps the configured handle in parens', () => {
    expect(matchesConfiguredHandle('alice', 'Alice Wonderland (alice)')).toBe(true);
  });

  test('returns false when normalized strings differ and parens do not match', () => {
    expect(matchesConfiguredHandle('alice', 'bob')).toBe(false);
    expect(matchesConfiguredHandle('alice', 'Alice (other)')).toBe(false);
  });

  test('matches when both handles are the same after normalization', () => {
    expect(matchesConfiguredHandle('ALICE', 'alice')).toBe(true);
  });
});
