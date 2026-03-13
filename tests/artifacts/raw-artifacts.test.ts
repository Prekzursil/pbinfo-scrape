import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { exportRawSnapshotArtifacts, importRawSnapshotArtifacts } from '../../src/artifacts/raw-artifacts.js';

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
});
