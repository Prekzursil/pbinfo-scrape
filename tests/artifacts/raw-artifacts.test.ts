import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import {
  exportRawSnapshotArtifacts,
  importRawSnapshotArtifacts,
  relinkRawSnapshotArtifacts,
} from '../../src/artifacts/raw-artifacts.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('raw artifact export/import', () => {
  test('exports and reimports a raw snapshot tree through the artifact directory', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-artifacts-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-2026-03-10',
      scope: 'public',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    mkdirSync(join(snapshot.rawPagesRoot), { recursive: true });
    mkdirSync(join(snapshot.rawAssetsRoot), { recursive: true });
    writeFileSync(
      join(snapshot.rawPagesRoot, 'page-https-www-pbinfo-ro-root.html'),
      '<html><body>root</body></html>',
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawAssetsRoot, 'asset-https-www-pbinfo-ro-static-site-css.css'),
      'body { color: red; }',
      'utf8',
    );

    const exported = await exportRawSnapshotArtifacts({
      workspaceRoot,
      snapshotId: 'snapshot-2026-03-10',
    });

    expect(readFileSync(join(exported.targetRoot, 'raw-pages', 'page-https-www-pbinfo-ro-root.html'), 'utf8')).toContain('root');
    expect(JSON.parse(readFileSync(join(exported.targetRoot, 'manifest.json'), 'utf8'))).toMatchObject({
      snapshotId: 'snapshot-2026-03-10',
    });

    rmSync(snapshot.rawPagesRoot, { recursive: true, force: true });
    rmSync(snapshot.rawAssetsRoot, { recursive: true, force: true });

    const imported = await importRawSnapshotArtifacts({
      workspaceRoot,
      snapshotId: 'snapshot-2026-03-10',
      sourcePath: exported.manifestPath,
    });

    expect(imported.snapshotRoot).toBe(join(workspaceRoot, 'output', 'artifacts', 'snapshot-2026-03-10'));
    expect(readFileSync(join(snapshot.rawAssetsRoot, 'asset-https-www-pbinfo-ro-static-site-css.css'), 'utf8')).toContain('color: red');
  });

  test('relinks a snapshot to external raw artifacts without copying into output/artifacts', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-artifacts-relink-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-2026-03-11',
      scope: 'public',
      now: new Date('2026-03-11T00:00:00.000Z'),
    });
    mkdirSync(snapshot.rawPagesRoot, { recursive: true });
    mkdirSync(snapshot.rawAssetsRoot, { recursive: true });
    writeFileSync(join(snapshot.rawPagesRoot, 'page.html'), '<html>ok</html>', 'utf8');
    writeFileSync(join(snapshot.rawAssetsRoot, 'style.css'), 'body{color:blue}', 'utf8');
    writeFileSync(
      join(snapshot.rawPagesRoot, 'manifest.json'),
      JSON.stringify({ 'https://www.pbinfo.ro/': 'page.html' }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawAssetsRoot, 'manifest.json'),
      JSON.stringify({ 'https://www.pbinfo.ro/style.css': 'style.css' }, null, 2),
      'utf8',
    );

    const externalRoot = join(workspaceRoot, 'external-artifacts');
    const exported = await exportRawSnapshotArtifacts({
      workspaceRoot,
      snapshotId: snapshot.snapshotId,
      targetPath: externalRoot,
    });

    rmSync(snapshot.rawPagesRoot, { recursive: true, force: true });
    rmSync(snapshot.rawAssetsRoot, { recursive: true, force: true });

    const relinked = await relinkRawSnapshotArtifacts({
      workspaceRoot,
      snapshotId: snapshot.snapshotId,
      sourcePath: exported.manifestPath,
    });

    expect(relinked.snapshotId).toBe(snapshot.snapshotId);
    expect(relinked.rawPagesPath).toContain(join('external-artifacts', snapshot.snapshotId, 'raw-pages'));
    expect(existsSync(join(config.paths.localRoot, 'artifact-relinks.json'))).toBe(true);
  });

  test('exports the catalog current snapshot when snapshotId is "latest"', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-artifacts-latest-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-latest',
      scope: 'public',
      now: new Date('2026-03-12T00:00:00.000Z'),
    });
    mkdirSync(snapshot.rawPagesRoot, { recursive: true });
    mkdirSync(snapshot.rawAssetsRoot, { recursive: true });
    writeFileSync(join(snapshot.rawPagesRoot, 'page.html'), '<html>ok</html>', 'utf8');

    const exported = await exportRawSnapshotArtifacts({ workspaceRoot, snapshotId: 'latest' });
    expect(exported.snapshotId).toBe('snapshot-latest');
  });

  test('imports from a directory source by appending manifest.json', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-artifacts-dir-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-dir',
      scope: 'public',
      now: new Date('2026-03-13T00:00:00.000Z'),
    });
    mkdirSync(snapshot.rawPagesRoot, { recursive: true });
    mkdirSync(snapshot.rawAssetsRoot, { recursive: true });
    writeFileSync(join(snapshot.rawPagesRoot, 'page.html'), '<html>ok</html>', 'utf8');

    const exported = await exportRawSnapshotArtifacts({ workspaceRoot, snapshotId: 'snapshot-dir' });
    rmSync(snapshot.rawPagesRoot, { recursive: true, force: true });

    const imported = await importRawSnapshotArtifacts({
      workspaceRoot,
      snapshotId: 'snapshot-dir',
      sourcePath: exported.targetRoot,
    });
    expect(imported.snapshotId).toBe('snapshot-dir');

    const relinked = await relinkRawSnapshotArtifacts({
      workspaceRoot,
      snapshotId: 'snapshot-dir',
      sourcePath: exported.targetRoot,
    });
    expect(relinked.snapshotId).toBe('snapshot-dir');
  });

  test('throws a clear error when import or relink is called without a source path', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-artifacts-nosrc-'));
    tempDirs.push(workspaceRoot);

    await expect(
      importRawSnapshotArtifacts({ workspaceRoot, snapshotId: 's' }),
    ).rejects.toThrow('Artifact import requires a manifest path.');
    await expect(
      relinkRawSnapshotArtifacts({ workspaceRoot, snapshotId: 's' }),
    ).rejects.toThrow('Artifact relink requires a manifest path.');
  });
});
