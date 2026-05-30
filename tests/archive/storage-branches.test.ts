import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  assertSnapshotRecord,
  exportRawArtifacts,
  markSnapshotCanonical,
  prepareSnapshot,
  pruneToCanonicalSnapshot,
  relinkRawArtifacts,
  writeArchiveCatalog,
  readArchiveCatalog,
} from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('storage helper branches', () => {
  test('assertSnapshotRecord throws when the snapshot is missing from the catalog', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-storage-missingsnap-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const catalog = readArchiveCatalog(config.paths.archiveRoot);
    expect(() => assertSnapshotRecord(catalog, 'ghost')).toThrow(/was not found/);
  });

  test('markSnapshotCanonical updates currentSnapshotId and canonicalSnapshotId', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-storage-markcanon-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    prepareSnapshot(config, {
      snapshotId: 'mark-canon',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    writeArchiveCatalog(config.paths.archiveRoot, {
      currentSnapshotId: undefined,
      canonicalSnapshotId: undefined,
      snapshots: [
        {
          snapshotId: 'mark-canon',
          createdAt: '2026-03-10T00:00:00.000Z',
          scope: 'all',
          status: 'completed',
          checkpoint: 'canonical',
        },
      ],
      artifactExports: [],
    });
    markSnapshotCanonical(config, 'mark-canon');
    const updated = readArchiveCatalog(config.paths.archiveRoot);
    expect(updated.currentSnapshotId).toBe('mark-canon');
    expect(updated.canonicalSnapshotId).toBe('mark-canon');
  });

  test('pruneToCanonicalSnapshot drops non-canonical snapshots and queue files', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-storage-prune-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const stale = prepareSnapshot(config, {
      snapshotId: 'stale-snap',
      scope: 'all',
      now: new Date('2026-03-08T00:00:00.000Z'),
    });
    const canonical = prepareSnapshot(config, {
      snapshotId: 'canonical-snap',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    exportRawArtifacts(config, stale);
    exportRawArtifacts(config, canonical);
    writeArchiveCatalog(config.paths.archiveRoot, {
      currentSnapshotId: canonical.snapshotId,
      canonicalSnapshotId: canonical.snapshotId,
      snapshots: [
        {
          snapshotId: stale.snapshotId,
          createdAt: '2026-03-08T00:00:00.000Z',
          scope: 'all',
          status: 'completed',
          checkpoint: 'checkpoint',
        },
        {
          snapshotId: canonical.snapshotId,
          createdAt: '2026-03-10T00:00:00.000Z',
          scope: 'all',
          status: 'completed',
          checkpoint: 'canonical',
        },
      ],
      artifactExports: [
        {
          snapshotId: canonical.snapshotId,
          exportedAt: '2026-03-10T00:00:00.000Z',
          manifestPath: canonical.artifactManifestPath,
          exportRoot: join(config.artifacts.exportRoot, canonical.snapshotId),
        },
      ],
    });
    const queueRoot = join(config.paths.localRoot, 'crawl-queues');
    mkdirSync(queueRoot, { recursive: true });
    writeFileSync(join(queueRoot, 'stale-snap.sqlite'), '', 'utf8');
    writeFileSync(join(queueRoot, 'canonical-snap.sqlite'), '', 'utf8');

    const result = pruneToCanonicalSnapshot(config, canonical.snapshotId);
    expect(result.removedSnapshots).toContain(stale.snapshotId);
    expect(result.removedQueuePaths).toEqual(
      expect.arrayContaining([join(queueRoot, 'stale-snap.sqlite')]),
    );
    expect(existsSync(join(queueRoot, 'canonical-snap.sqlite'))).toBe(true);
  });

  test('pruneToCanonicalSnapshot returns empty paths when crawl-queues directory is absent (lines 279-280)', () => {
    // removeNonCanonicalQueues returns early when the crawl-queues dir does not exist.
    // This exercises lines 279-280 in storage.ts.
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-storage-no-queues-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const snap = prepareSnapshot(config, {
      snapshotId: 'only-snap',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    writeArchiveCatalog(config.paths.archiveRoot, {
      currentSnapshotId: snap.snapshotId,
      canonicalSnapshotId: snap.snapshotId,
      snapshots: [
        {
          snapshotId: snap.snapshotId,
          createdAt: '2026-03-10T00:00:00.000Z',
          scope: 'all',
          status: 'completed',
          checkpoint: 'canonical',
        },
      ],
      artifactExports: [],
    });
    // Do NOT create the crawl-queues directory — the early-return branch fires.
    const result = pruneToCanonicalSnapshot(config, snap.snapshotId);
    expect(result.removedQueuePaths).toEqual([]);
  });

  test('relinkRawArtifacts rejects a manifest with mismatched snapshot id', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-storage-relink-mismatch-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snap-correct',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const exported = exportRawArtifacts(
      config,
      snapshot,
      join(workspaceRoot, 'external-artifacts'),
      new Date('2026-03-10T01:00:00.000Z'),
    );
    expect(() =>
      relinkRawArtifacts(
        config,
        'snap-different',
        join(workspaceRoot, 'external-artifacts', snapshot.snapshotId, 'manifest.json'),
      ),
    ).toThrow(/snapshot mismatch/);
    expect(existsSync(exported.rawPagesPath)).toBe(true);
  });

  test('relinkRawArtifacts accepts a directory-style manifest path', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-storage-relink-dir-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snap-dir-relink',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    exportRawArtifacts(
      config,
      snapshot,
      join(workspaceRoot, 'external-artifacts'),
      new Date('2026-03-10T01:00:00.000Z'),
    );
    const manifest = relinkRawArtifacts(
      config,
      snapshot.snapshotId,
      join(workspaceRoot, 'external-artifacts', snapshot.snapshotId),
    );
    expect(manifest.snapshotId).toBe(snapshot.snapshotId);
  });

  test('readArtifactRelinkRegistry resists a corrupted artifact-relinks.json file', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-storage-corrupted-relinks-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    mkdirSync(config.paths.localRoot, { recursive: true });
    writeFileSync(
      join(config.paths.localRoot, 'artifact-relinks.json'),
      'not-json',
      'utf8',
    );
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'corrupted-relinks-snap',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    exportRawArtifacts(
      config,
      snapshot,
      join(workspaceRoot, 'external-artifacts'),
      new Date('2026-03-10T01:00:00.000Z'),
    );
    const manifest = relinkRawArtifacts(
      config,
      snapshot.snapshotId,
      join(workspaceRoot, 'external-artifacts', snapshot.snapshotId, 'manifest.json'),
    );
    expect(manifest.snapshotId).toBe(snapshot.snapshotId);
  });

  test('relinkRawArtifacts throws when a referenced raw artifact directory is missing', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-storage-missing-raw-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'missing-raw-snap',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const exported = exportRawArtifacts(
      config,
      snapshot,
      join(workspaceRoot, 'external-artifacts'),
      new Date('2026-03-10T01:00:00.000Z'),
    );
    // Wipe the raw-pages directory referenced by the manifest.
    rmSync(exported.rawPagesPath, { recursive: true, force: true });
    expect(() =>
      relinkRawArtifacts(
        config,
        snapshot.snapshotId,
        join(workspaceRoot, 'external-artifacts', snapshot.snapshotId, 'manifest.json'),
      ),
    ).toThrow(/Raw artifact path is missing/);
  });
});
