import { describe, expect, test } from 'vitest';

import { buildFreshSnapshotId } from '../../src/archive/storage.js';

describe('buildFreshSnapshotId', () => {
  test('emits fresh-YYYYMMDD-full for the provided UTC date', () => {
    expect(buildFreshSnapshotId(new Date('2026-04-23T07:45:00.000Z'))).toBe(
      'fresh-20260423-full',
    );
  });

  test('zero-pads month and day', () => {
    expect(buildFreshSnapshotId(new Date('2026-01-02T00:00:00.000Z'))).toBe(
      'fresh-20260102-full',
    );
  });

  test('ignores local-time offsets and uses UTC components', () => {
    // A time right after midnight UTC on the 1st is still the 1st in the id
    // regardless of the host's timezone.
    expect(buildFreshSnapshotId(new Date('2026-06-01T00:00:01.000Z'))).toBe(
      'fresh-20260601-full',
    );
  });
});
