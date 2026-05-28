import { describe, expect, test } from 'vitest';

import { isOfficialSourceAuthorHandle } from '../../src/pbinfo/official-source-authors.js';

describe('official source author handles', () => {
  test('recognizes the pbinfo handle regardless of casing and surrounding whitespace', () => {
    expect(isOfficialSourceAuthorHandle('pbinfo')).toBe(true);
    expect(isOfficialSourceAuthorHandle('  PBInfo ')).toBe(true);
  });

  test('rejects non-official and empty handles', () => {
    expect(isOfficialSourceAuthorHandle('Prekzursil')).toBe(false);
    expect(isOfficialSourceAuthorHandle(undefined)).toBe(false);
    expect(isOfficialSourceAuthorHandle('')).toBe(false);
  });
});
