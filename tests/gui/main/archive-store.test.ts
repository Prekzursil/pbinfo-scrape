import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';

import {
  getArchiveStorePath,
  readArchiveStore,
  writeArchiveStore,
} from '../../../src/gui/main/archive-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('archive-store', () => {
  test('returns empty state when file is absent', () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-archive-store-'));
    tempDirs.push(userData);

    expect(readArchiveStore(userData)).toEqual({});
  });

  test('persists and reads back manualArchiveOverride', () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-archive-store-'));
    tempDirs.push(userData);

    writeArchiveStore(userData, { manualArchiveOverride: 'C:/my/archive' });

    expect(readArchiveStore(userData)).toEqual({
      manualArchiveOverride: 'C:/my/archive',
    });
    expect(existsSync(getArchiveStorePath(userData))).toBe(true);
  });

  test('tolerates and drops legacy workspaceRoot / recentWorkspaces keys on load', () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-archive-store-'));
    tempDirs.push(userData);

    writeFileSync(
      getArchiveStorePath(userData),
      JSON.stringify({
        manualArchiveOverride: 'D:/archive',
        workspaceRoot: 'C:/legacy',
        recentWorkspaces: ['C:/legacy'],
      }),
      'utf8',
    );

    expect(readArchiveStore(userData)).toEqual({
      manualArchiveOverride: 'D:/archive',
    });
  });

  test('rejects malformed JSON gracefully by returning empty state', () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-archive-store-'));
    tempDirs.push(userData);

    writeFileSync(getArchiveStorePath(userData), '{ not json', 'utf8');

    expect(readArchiveStore(userData)).toEqual({});
  });

  test('enforces Zod schema: path string max length 4096', () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-archive-store-'));
    tempDirs.push(userData);

    expect(() =>
      writeArchiveStore(userData, {
        manualArchiveOverride: 'a'.repeat(4097),
      }),
    ).toThrow();
  });
});
