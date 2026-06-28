import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { loadLocalConfig } from '../../src/config/local-config.js';
import {
  assertArtifactExportRecord,
  buildQueuePath,
  buildSnapshotId,
  exportRawArtifacts,
  importRawArtifacts,
  markSnapshotCanonical,
  markSnapshotCompleted,
  prepareSnapshot,
  pruneToCanonicalSnapshot,
  readArchiveCatalog,
  relinkRawArtifacts,
  resolveReadableSnapshotLayout,
} from '../../src/archive/storage.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-storage-'));
  tempDirs.push(root);
  return root;
}

function seedRawArtifacts(layout: { rawPagesRoot: string; rawAssetsRoot: string }): void {
  mkdirSync(layout.rawPagesRoot, { recursive: true });
  mkdirSync(layout.rawAssetsRoot, { recursive: true });
  writeFileSync(join(layout.rawPagesRoot, 'manifest.json'), '{}', 'utf8');
  writeFileSync(join(layout.rawAssetsRoot, 'manifest.json'), '{}', 'utf8');
  writeFileSync(join(layout.rawPagesRoot, 'page.html'), '<html></html>', 'utf8');
}

describe('storage snapshot lifecycle', () => {
  test('marks a snapshot completed and canonical', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    const layout = prepareSnapshot(config, { snapshotId: 'S1', scope: 'all', now: new Date('2026-01-01T00:00:00Z') });

    markSnapshotCompleted(config, 'S1');
    const metadata = JSON.parse(readFileSync(layout.metadataPath, 'utf8')) as { status: string };
    expect(metadata.status).toBe('completed');

    const canonical = markSnapshotCanonical(config, 'S1');
    expect(canonical.snapshotId).toBe('S1');
    const catalog = readArchiveCatalog(config.paths.archiveRoot);
    expect(catalog.canonicalSnapshotId).toBe('S1');
  });

  test('markSnapshotCompleted tolerates a missing metadata file but rethrows other errors', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    const layout = prepareSnapshot(config, { snapshotId: 'S2', scope: 'all', now: new Date() });

    rmSync(layout.metadataPath, { force: true });
    expect(() => markSnapshotCompleted(config, 'S2')).not.toThrow();

    // Replace metadata with a directory so readFileSync raises a non-ENOENT error.
    mkdirSync(layout.metadataPath, { recursive: true });
    expect(() => markSnapshotCompleted(config, 'S2')).toThrow();
  });

  test('markSnapshotCompleted is a no-op for an unknown snapshot', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'S3', scope: 'all', now: new Date() });
    expect(() => markSnapshotCompleted(config, 'does-not-exist')).not.toThrow();
  });

  test('markSnapshotCanonical throws for a snapshot missing from the catalog', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'S4', scope: 'all', now: new Date() });
    expect(() => markSnapshotCanonical(config, 'ghost')).toThrow(/was not found/);
  });

  test('resolveReadableSnapshotLayout throws without a current snapshot', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    expect(() => resolveReadableSnapshotLayout(config)).toThrow(/No archived snapshot/);
  });
});

describe('storage raw-artifact export, import, relink', () => {
  test('exports, asserts, imports and relinks raw artifacts', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    const layout = prepareSnapshot(config, { snapshotId: 'A1', scope: 'all', now: new Date() });
    seedRawArtifacts(layout);

    const manifest = exportRawArtifacts(config, layout, undefined, new Date('2026-01-02T00:00:00Z'));
    expect(manifest.snapshotId).toBe('A1');

    const record = assertArtifactExportRecord(config, 'A1');
    expect(record.snapshotId).toBe('A1');

    const exportDir = join(config.artifacts.exportRoot, 'A1');
    // Importing from a directory exercises resolveArtifactManifestPath's join branch.
    const reimported = importRawArtifacts(config, exportDir);
    expect(reimported.snapshotId).toBe('A1');

    // Relinking from a .json path exercises the other resolveArtifactManifestPath branch.
    const relinked = relinkRawArtifacts(config, 'A1', join(exportDir, 'manifest.json'));
    expect(relinked.snapshotId).toBe('A1');
  });

  test('relinkRawArtifacts rejects a snapshot id mismatch', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    const layout = prepareSnapshot(config, { snapshotId: 'A2', scope: 'all', now: new Date() });
    seedRawArtifacts(layout);
    const manifest = exportRawArtifacts(config, layout);
    expect(() => relinkRawArtifacts(config, 'OTHER', manifest.rawPagesManifestPath)).toThrow(/mismatch/);
  });

  test('relinkRawArtifacts throws when raw artifact paths are missing', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'A3', scope: 'all', now: new Date() });
    const manifestPath = join(root, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        snapshotId: 'A3',
        exportedAt: '2026-01-01T00:00:00Z',
        rawPagesPath: join(root, 'missing-pages'),
        rawAssetsPath: join(root, 'missing-assets'),
        rawPagesManifestPath: join(root, 'missing-pages', 'manifest.json'),
        rawAssetsManifestPath: join(root, 'missing-assets', 'manifest.json'),
      }),
      'utf8',
    );
    expect(() => relinkRawArtifacts(config, 'A3', manifestPath)).toThrow(/missing/);
  });

  test('assertArtifactExportRecord throws when no export exists', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'A4', scope: 'all', now: new Date() });
    expect(() => assertArtifactExportRecord(config, 'A4')).toThrow(/missing or unreadable/);
  });

  test('resolves a relinked manifest from a directory path and survives a corrupt registry', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    const layout = prepareSnapshot(config, { snapshotId: 'A5', scope: 'all', now: new Date() });
    seedRawArtifacts(layout);
    const manifest = exportRawArtifacts(config, layout);
    // Pass the export directory (no .json) to exercise resolveArtifactManifestPath.
    const exportDir = join(config.artifacts.exportRoot, 'A5');
    expect(relinkRawArtifacts(config, 'A5', exportDir).snapshotId).toBe('A5');
    expect(manifest.snapshotId).toBe('A5');

    // Corrupt the relink registry; readers should fall back to an empty registry.
    writeFileSync(join(config.paths.localRoot, 'artifact-relinks.json'), '{ broken', 'utf8');
    const reloaded = loadLocalConfig(root);
    expect(() => resolveReadableSnapshotLayout(reloaded, 'A5')).not.toThrow();
  });
});

describe('storage helpers and defaults', () => {
  test('buildSnapshotId formats a compact UTC id and buildQueuePath joins the queue root', () => {
    expect(buildSnapshotId(new Date('2026-03-10T12:34:56.789Z'))).toBe('20260310T123456Z');
    expect(buildQueuePath('/root', 'SNAP')).toContain('SNAP.sqlite');
  });

  test('prepareSnapshot defaults the id and timestamp, then updates the existing record', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    const first = prepareSnapshot(config, { scope: 'public' });
    expect(first.snapshotId).toMatch(/Z$/);
    // Re-preparing the same id updates the existing catalog record in place.
    const again = prepareSnapshot(config, { snapshotId: first.snapshotId, scope: 'user' });
    expect(again.snapshotId).toBe(first.snapshotId);
    const catalog = readArchiveCatalog(config.paths.archiveRoot);
    expect(catalog.snapshots.filter((s) => s.snapshotId === first.snapshotId)).toHaveLength(1);
    // Original scope is preserved across re-preparation.
    expect(catalog.snapshots[0]?.scope).toBe('public');
  });

  test('assertArtifactExportRecord throws when the recorded manifest file is gone', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    const layout = prepareSnapshot(config, { snapshotId: 'M1', scope: 'all', now: new Date() });
    seedRawArtifacts(layout);
    exportRawArtifacts(config, layout);
    // Remove the relink registry so the catalog path is taken. The manifest still
    // exists, so the catalog record is returned successfully.
    rmSync(join(config.paths.localRoot, 'artifact-relinks.json'), { force: true });
    expect(assertArtifactExportRecord(config, 'M1').snapshotId).toBe('M1');

    // Now delete the manifest file so the existsSync guard fails.
    rmSync(layout.artifactManifestPath, { force: true });
    expect(() => assertArtifactExportRecord(config, 'M1')).toThrow(/missing or unreadable/);
  });

  test('tolerates a non-array relink registry and a vanished relinked artifact path', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    const layout = prepareSnapshot(config, { snapshotId: 'R1', scope: 'all', now: new Date() });
    seedRawArtifacts(layout);
    exportRawArtifacts(config, layout);

    // Non-array entries -> registry falls back to empty.
    writeFileSync(
      join(config.paths.localRoot, 'artifact-relinks.json'),
      JSON.stringify({ entries: 'not-an-array' }),
      'utf8',
    );
    expect(() => resolveReadableSnapshotLayout(config, 'R1')).not.toThrow();

    // Restore a valid relink entry, then delete its raw pages so resolution falls back.
    exportRawArtifacts(config, layout);
    rmSync(join(config.artifacts.exportRoot, 'R1', 'raw-pages'), { recursive: true, force: true });
    const reloaded = loadLocalConfig(root);
    const resolved = resolveReadableSnapshotLayout(reloaded, 'R1');
    expect(resolved.snapshotId).toBe('R1');
  });
});

describe('storage pruning', () => {
  test('prunes non-canonical snapshots, queues, and artifacts', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    const keep = prepareSnapshot(config, { snapshotId: 'KEEP', scope: 'all', now: new Date('2026-01-01T00:00:00Z') });
    seedRawArtifacts(keep);
    exportRawArtifacts(config, keep);
    const drop = prepareSnapshot(config, { snapshotId: 'DROP', scope: 'all', now: new Date('2026-01-02T00:00:00Z') });
    seedRawArtifacts(drop);
    exportRawArtifacts(config, drop);

    // Queue files for both snapshots.
    mkdirSync(join(config.paths.localRoot, 'crawl-queues'), { recursive: true });
    writeFileSync(join(config.paths.localRoot, 'crawl-queues', 'KEEP.sqlite'), '', 'utf8');
    writeFileSync(join(config.paths.localRoot, 'crawl-queues', 'DROP.sqlite'), '', 'utf8');

    const result = pruneToCanonicalSnapshot(config, 'KEEP');
    expect(result.removedSnapshots).toEqual(['DROP']);
    expect(result.removedQueuePaths.some((p) => p.endsWith('DROP.sqlite'))).toBe(true);
    expect(result.removedArtifactPaths.length).toBeGreaterThan(0);
    expect(existsSync(join(config.paths.archiveRoot, 'snapshots', 'DROP'))).toBe(false);
    expect(existsSync(join(config.paths.archiveRoot, 'snapshots', 'KEEP'))).toBe(true);
  });
});
