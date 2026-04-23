import { describe, expect, test } from 'vitest';

import {
  archiveProbeResultSchema,
  archiveSetManualOverrideInputSchema,
  archiveSwitchSnapshotInputSchema,
  libraryGetThemeResultSchema,
  librarySetThemeInputSchema,
} from '../../../src/gui/shared/contracts.js';

describe('archive + theme contracts', () => {
  test('archiveSetManualOverrideInputSchema rejects empty paths', () => {
    expect(() =>
      archiveSetManualOverrideInputSchema.parse({ absolutePath: '' }),
    ).toThrow();
  });

  test('archiveSetManualOverrideInputSchema rejects paths over 4096 chars', () => {
    expect(() =>
      archiveSetManualOverrideInputSchema.parse({
        absolutePath: 'a'.repeat(4097),
      }),
    ).toThrow();
  });

  test('archiveSwitchSnapshotInputSchema requires a non-empty snapshotId', () => {
    expect(() =>
      archiveSwitchSnapshotInputSchema.parse({ snapshotId: '' }),
    ).toThrow();
    expect(
      archiveSwitchSnapshotInputSchema.parse({ snapshotId: 'snap-1' }).snapshotId,
    ).toBe('snap-1');
  });

  test('archiveProbeResultSchema accepts minimal not-found shape', () => {
    const parsed = archiveProbeResultSchema.parse({
      found: false,
      probedPaths: ['/a', '/b'],
    });
    expect(parsed.found).toBe(false);
  });

  test('archiveProbeResultSchema accepts full found shape with catalog snapshots', () => {
    const parsed = archiveProbeResultSchema.parse({
      found: true,
      archiveRoot: '/a/archive',
      snapshotId: 'snap-1',
      probedPaths: ['/a/archive'],
      catalogSnapshots: [
        {
          id: 'snap-1',
          status: 'completed',
          createdAt: '2026-04-23T00:00:00Z',
        },
      ],
    });
    expect(parsed.catalogSnapshots).toHaveLength(1);
  });

  test('themePreferenceSchema only allows auto/light/dark', () => {
    expect(() =>
      librarySetThemeInputSchema.parse({ preference: 'sepia' }),
    ).toThrow();
    expect(
      librarySetThemeInputSchema.parse({ preference: 'auto' }).preference,
    ).toBe('auto');
  });

  test('libraryGetThemeResultSchema rejects unknown effective value', () => {
    expect(() =>
      libraryGetThemeResultSchema.parse({
        effective: 'sepia',
        preference: 'auto',
      }),
    ).toThrow();
  });
});
