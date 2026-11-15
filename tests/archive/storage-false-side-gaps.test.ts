import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  importRawArtifacts,
  prepareSnapshot,
  pruneToCanonicalSnapshot,
  type ArtifactManifest,
} from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-storage-gaps-'));
  tempDirs.push(root);
  return root;
}

describe('pruneToCanonicalSnapshot sparse-workspace false sides', () => {
  test('prunes a bare snapshot with no artifacts, exports, or queue root', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'KEEP', scope: 'all', now: new Date('2026-01-01T00:00:00Z') });
    prepareSnapshot(config, { snapshotId: 'DROP', scope: 'all', now: new Date('2026-01-02T00:00:00Z') });
    // prepareSnapshot creates the per-snapshot artifacts directory; drop it so
    // pruning sees a snapshot with neither artifacts dir, nor exported manifest.
    rmSync(join(config.paths.artifactsRoot, 'DROP'), { recursive: true, force: true });

    const result = pruneToCanonicalSnapshot(config, 'KEEP');
    expect(result.removedSnapshots).toEqual(['DROP']);
    // No artifacts-root dir, no artifact manifest, no export record, and no
    // crawl-queues root existed, so nothing beyond the snapshot layout was removed.
    expect(result.removedArtifactPaths).toEqual([]);
    expect(result.removedQueuePaths).toEqual([]);
    expect(existsSync(join(config.paths.archiveRoot, 'snapshots', 'DROP'))).toBe(false);
  });
});

describe('importRawArtifacts local-path false sides', () => {
  test('skips copying when the manifest already points at the local raw roots', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'LOCAL1', scope: 'all', now: new Date() });

    // Seed content at the destination paths and point the manifest straight at
    // them: both cpSync branches are skipped because source resolves to target.
    const localPagesRoot = join(config.paths.artifactsRoot, 'LOCAL1', 'raw-pages');
    const localAssetsRoot = join(config.paths.artifactsRoot, 'LOCAL1', 'raw-assets');
    mkdirSync(localPagesRoot, { recursive: true });
    mkdirSync(localAssetsRoot, { recursive: true });
    writeFileSync(join(localPagesRoot, 'existing.html'), '<html></html>', 'utf8');
    writeFileSync(join(localAssetsRoot, 'existing.css'), 'body{}', 'utf8');

    const manifest: ArtifactManifest = {
      snapshotId: 'LOCAL1',
      exportedAt: '2026-02-01T00:00:00.000Z',
      rawPagesPath: localPagesRoot,
      rawAssetsPath: localAssetsRoot,
      rawPagesManifestPath: join(localPagesRoot, 'manifest.json'),
      rawAssetsManifestPath: join(localAssetsRoot, 'manifest.json'),
    };
    const manifestDir = join(config.paths.localRoot, 'self-manifest');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');

    const imported = importRawArtifacts(config, manifestDir);
    expect(imported.snapshotId).toBe('LOCAL1');
    expect(imported.rawPagesPath).toBe(localPagesRoot);
    expect(existsSync(join(localPagesRoot, 'existing.html'))).toBe(true);
  });
});
