import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';

import {
  CATALOG_MAX_BYTES,
  resolveArchiveRoot,
} from '../../../src/gui/main/archive-resolver.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface TempCatalog {
  currentSnapshotId?: string;
  snapshots?: Array<{ id: string; status?: string; createdAt?: string }>;
}

function makeTempArchive(label: string, catalog: TempCatalog): string {
  const root = mkdtempSync(join(tmpdir(), `pbinfo-archive-${label}-`));
  tempDirs.push(root);
  const archiveRoot = join(root, 'archive');
  mkdirSync(archiveRoot, { recursive: true });
  for (const snap of catalog.snapshots ?? []) {
    mkdirSync(join(archiveRoot, 'snapshots', snap.id), { recursive: true });
  }
  writeFileSync(
    join(archiveRoot, 'catalog.json'),
    JSON.stringify(catalog),
    'utf8',
  );
  return archiveRoot;
}

describe('archive-resolver', () => {
  test('returns not-found when no probe path holds a catalog', () => {
    const empty = mkdtempSync(join(tmpdir(), 'pbinfo-empty-'));
    tempDirs.push(empty);

    const result = resolveArchiveRoot({
      exeDir: empty,
      cwd: empty,
      manualOverride: undefined,
    });

    expect(result.found).toBe(false);
    expect(result.probedPaths).toHaveLength(3);
  });

  test('finds archive at <exe-dir>/archive and picks currentSnapshotId', () => {
    const archiveRoot = makeTempArchive('exe', {
      currentSnapshotId: 'snap-1',
      snapshots: [{ id: 'snap-1', status: 'completed' }],
    });
    const exeDir = archiveRoot.replace(/[\\/]archive$/u, '');

    const result = resolveArchiveRoot({
      exeDir,
      cwd: '/tmp/unrelated',
      manualOverride: undefined,
    });

    expect(result.found).toBe(true);
    expect(result.archiveRoot).toBe(archiveRoot);
    expect(result.snapshotId).toBe('snap-1');
  });

  test('falls back to newest completed snapshot when currentSnapshotId is missing', () => {
    const archiveRoot = makeTempArchive('fallback', {
      snapshots: [
        { id: 'older', status: 'completed', createdAt: '2026-04-20T00:00:00Z' },
        { id: 'newer', status: 'completed', createdAt: '2026-04-23T00:00:00Z' },
        { id: 'inprogress', status: 'running', createdAt: '2026-04-24T00:00:00Z' },
      ],
    });
    mkdirSync(join(archiveRoot, 'snapshots', 'newer'), { recursive: true });
    mkdirSync(join(archiveRoot, 'snapshots', 'older'), { recursive: true });
    const exeDir = archiveRoot.replace(/[\\/]archive$/u, '');

    const result = resolveArchiveRoot({
      exeDir,
      cwd: '/tmp/unrelated',
      manualOverride: undefined,
    });

    expect(result.found).toBe(true);
    expect(result.snapshotId).toBe('newer');
  });

  test('rejects catalog larger than CATALOG_MAX_BYTES', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-big-'));
    tempDirs.push(root);
    const archiveRoot = join(root, 'archive');
    mkdirSync(archiveRoot, { recursive: true });
    writeFileSync(
      join(archiveRoot, 'catalog.json'),
      'x'.repeat(CATALOG_MAX_BYTES + 1),
      'utf8',
    );

    const result = resolveArchiveRoot({
      exeDir: root,
      cwd: root,
      manualOverride: undefined,
    });

    expect(result.found).toBe(false);
  });

  test('tolerates malformed catalog JSON and continues probing', () => {
    const broken = mkdtempSync(join(tmpdir(), 'pbinfo-broken-'));
    tempDirs.push(broken);
    mkdirSync(join(broken, 'archive'), { recursive: true });
    writeFileSync(join(broken, 'archive', 'catalog.json'), '{ not json', 'utf8');

    const good = makeTempArchive('good', {
      currentSnapshotId: 'snap-1',
      snapshots: [{ id: 'snap-1', status: 'completed' }],
    });
    const goodExe = good.replace(/[\\/]archive$/u, '');

    const result = resolveArchiveRoot({
      exeDir: broken,
      cwd: goodExe,
      manualOverride: undefined,
    });

    expect(result.found).toBe(true);
    expect(result.archiveRoot).toBe(good);
  });

  test('prefers manual override over all three auto-probe paths', () => {
    const manual = makeTempArchive('manual', {
      currentSnapshotId: 'manual-snap',
      snapshots: [{ id: 'manual-snap', status: 'completed' }],
    });
    const auto = makeTempArchive('auto', {
      currentSnapshotId: 'auto-snap',
      snapshots: [{ id: 'auto-snap', status: 'completed' }],
    });

    const result = resolveArchiveRoot({
      exeDir: auto.replace(/[\\/]archive$/u, ''),
      cwd: '/tmp/unrelated',
      manualOverride: manual,
    });

    expect(result.archiveRoot).toBe(manual);
    expect(result.snapshotId).toBe('manual-snap');
  });

  test('silently drops stale manual override whose directory no longer exists', () => {
    const auto = makeTempArchive('auto2', {
      currentSnapshotId: 'auto-snap',
      snapshots: [{ id: 'auto-snap', status: 'completed' }],
    });

    const result = resolveArchiveRoot({
      exeDir: auto.replace(/[\\/]archive$/u, ''),
      cwd: '/tmp/unrelated',
      manualOverride: '/path/that/does/not/exist',
    });

    expect(result.found).toBe(true);
    expect(result.archiveRoot).toBe(auto);
  });

  test('tolerates real-catalog shape where snapshots carry `snapshotId` instead of `id`', () => {
    // Regression guard for a real crash found via the packaged electron smoke
    // in Task 11: archive/catalog.json on disk uses `snapshotId`, but my
    // original fixtures used `id`, so this mismatch slipped past the unit
    // suite until the real archive was probed.
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-real-catalog-'));
    tempDirs.push(root);
    const archiveRoot = join(root, 'archive');
    mkdirSync(
      join(archiveRoot, 'snapshots', 'fresh-20260423-full'),
      { recursive: true },
    );
    writeFileSync(
      join(archiveRoot, 'catalog.json'),
      JSON.stringify({
        currentSnapshotId: 'fresh-20260423-full',
        snapshots: [
          {
            snapshotId: 'fresh-20260423-full',
            status: 'completed',
            createdAt: '2026-04-23T05:00:15.758Z',
          },
        ],
      }),
    );

    const result = resolveArchiveRoot({
      exeDir: root,
      cwd: root,
      manualOverride: undefined,
    });

    expect(result.found).toBe(true);
    expect(result.snapshotId).toBe('fresh-20260423-full');
  });

  test('discards snapshotId when the snapshot directory does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-missing-snap-'));
    tempDirs.push(root);
    const archiveRoot = join(root, 'archive');
    mkdirSync(archiveRoot, { recursive: true });
    writeFileSync(
      join(archiveRoot, 'catalog.json'),
      JSON.stringify({
        currentSnapshotId: 'snap-1',
        snapshots: [{ id: 'snap-1', status: 'completed' }],
      }),
      'utf8',
    );

    const result = resolveArchiveRoot({
      exeDir: root,
      cwd: root,
      manualOverride: undefined,
    });

    expect(result.found).toBe(true);
    expect(result.snapshotId).toBeUndefined();
  });
});
