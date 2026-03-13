import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { startMirrorServer } from '../../src/mirror/server.js';

const tempDirs: string[] = [];
const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) {
    await stop();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('startMirrorServer', () => {
  test('serves mirrored routes and archived assets from localhost', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-serve-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-2026-03-10',
      scope: 'public',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const rawAssetsRoot = snapshot.rawAssetsRoot;
    const mirrorRoot = snapshot.mirrorRoot;
    mkdirSync(rawAssetsRoot, { recursive: true });
    mkdirSync(mirrorRoot, { recursive: true });
    mkdirSync(join(mirrorRoot, 'site', 'root'), { recursive: true });
    mkdirSync(join(mirrorRoot, 'site', 'probleme'), { recursive: true });

    writeFileSync(
      join(mirrorRoot, 'site', 'root', 'index.html'),
      '<html><body><h1>Home</h1></body></html>',
      'utf8',
    );
    writeFileSync(
      join(mirrorRoot, 'site', 'probleme', 'index.html'),
      '<html><body><h1>Probleme</h1></body></html>',
      'utf8',
    );
    writeFileSync(
      join(rawAssetsRoot, 'asset-https-www-pbinfo-ro-site-css.css'),
      'body { color: red; }',
      'utf8',
    );
    writeFileSync(
      snapshot.routesManifestPath,
      JSON.stringify(
        [
          {
            snapshotId: snapshot.snapshotId,
            route: '/',
            sourceFile: 'page-https-www-pbinfo-ro-root.html',
            template: 'raw-page',
            entityKey: '/',
            mirrorFile: 'site/root/index.html',
          },
          {
            snapshotId: snapshot.snapshotId,
            route: '/probleme',
            sourceFile: 'page-https-www-pbinfo-ro-probleme.html',
            template: 'raw-page',
            entityKey: '/probleme',
            mirrorFile: 'site/probleme/index.html',
          },
        ],
        null,
        2,
      ),
      'utf8',
    );

    const server = await startMirrorServer({
      workspaceRoot,
      port: 0,
    });
    stops.push(server.close);

    const homeResponse = await fetch(`${server.baseUrl}/`);
    const problemsResponse = await fetch(`${server.baseUrl}/probleme`);
    const assetResponse = await fetch(
      `${server.baseUrl}/_assets/asset-https-www-pbinfo-ro-site-css.css`,
    );

    expect(await homeResponse.text()).toContain('<h1>Home</h1>');
    expect(await problemsResponse.text()).toContain('<h1>Probleme</h1>');
    expect(await assetResponse.text()).toContain('body { color: red; }');
  });
});
