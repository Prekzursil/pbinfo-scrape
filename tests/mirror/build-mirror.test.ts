import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { buildMirrorArtifacts } from '../../src/mirror/build-mirror.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('buildMirrorArtifacts', () => {
  test('builds a route manifest and viewer index from archived raw pages', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-mirror-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-2026-03-10',
      scope: 'public',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const rawPagesRoot = snapshot.rawPagesRoot;
    const rawAssetsRoot = snapshot.rawAssetsRoot;
    mkdirSync(rawPagesRoot, { recursive: true });
    mkdirSync(rawAssetsRoot, { recursive: true });

    writeFileSync(
      join(rawPagesRoot, 'page-https-www-pbinfo-ro-root.html'),
      '<html><body><a href="https://www.pbinfo.ro/probleme">Probleme</a></body></html>',
      'utf8',
    );
    writeFileSync(
      join(rawPagesRoot, 'page-https-www-pbinfo-ro-probleme.html'),
      '<html><head><link rel="stylesheet" href="https://www.pbinfo.ro/static/site.css"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"><script src="https://use.fontawesome.com/releases/v5.5.0/js/all.js"></script><script>window.__CF$cv$params={r:\'abc\'};var a=document.createElement(\'script\');a.src=\'/cdn-cgi/challenge-platform/scripts/jsd/main.js\';</script><script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);}</script></head><body><h1>Probleme</h1></body></html>',
      'utf8',
    );
    writeFileSync(
      join(rawPagesRoot, 'manifest.json'),
      JSON.stringify(
        {
          'https://www.pbinfo.ro/': 'page-https-www-pbinfo-ro-root.html',
          'https://www.pbinfo.ro/probleme': 'page-https-www-pbinfo-ro-probleme.html',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(rawAssetsRoot, 'manifest.json'),
      JSON.stringify(
        {
          'https://www.pbinfo.ro/static/site.css': 'asset-https-www-pbinfo-ro-static-site-css.css',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(rawAssetsRoot, 'asset-https-www-pbinfo-ro-static-site-css.css'),
      'body { color: red; }',
      'utf8',
    );

    const pagesRoot = join(snapshot.normalizedRoot, 'pages');
    mkdirSync(pagesRoot, { recursive: true });
    writeFileSync(
      join(pagesRoot, 'page-root.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/',
        bodyPath: 'raw-pages/page-https-www-pbinfo-ro-root.html',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(pagesRoot, 'page-probleme.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/probleme',
        bodyPath: 'raw-pages/page-https-www-pbinfo-ro-probleme.html',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(pagesRoot, 'asset-site-css.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/static/site.css',
        bodyPath: 'raw-assets/asset-https-www-pbinfo-ro-static-site-css.css',
      }, null, 2),
      'utf8',
    );

    const routesRoot = join(snapshot.normalizedRoot, 'routes');
    mkdirSync(routesRoot, { recursive: true });
    writeFileSync(
      join(routesRoot, 'route-root.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        route: '/',
        sourceUrl: 'https://www.pbinfo.ro/',
        sourceFile: 'page-https-www-pbinfo-ro-root.html',
        template: 'raw-page',
        entityKey: '/',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(routesRoot, 'route-probleme.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        route: '/probleme',
        sourceUrl: 'https://www.pbinfo.ro/probleme',
        sourceFile: 'page-https-www-pbinfo-ro-probleme.html',
        template: 'raw-page',
        entityKey: '/probleme',
      }, null, 2),
      'utf8',
    );

    const result = await buildMirrorArtifacts(workspaceRoot);

    expect(result.routesBuilt).toBe(2);
    expect(result.outputRoot).toBe(snapshot.mirrorRoot);
    expect(JSON.parse(readFileSync(snapshot.routesManifestPath, 'utf8'))).toEqual([
      {
        snapshotId: snapshot.snapshotId,
        route: '/',
        sourceUrl: 'https://www.pbinfo.ro/',
        sourceFile: 'page-https-www-pbinfo-ro-root.html',
        template: 'raw-page',
        entityKey: '/',
        mirrorFile: 'site/root/index.html',
      },
      {
        snapshotId: snapshot.snapshotId,
        route: '/probleme',
        sourceUrl: 'https://www.pbinfo.ro/probleme',
        sourceFile: 'page-https-www-pbinfo-ro-probleme.html',
        template: 'raw-page',
        entityKey: '/probleme',
        mirrorFile: 'site/probleme/index.html',
      },
    ]);
    expect(readFileSync(join(snapshot.mirrorRoot, 'index.html'), 'utf8')).toContain('PBInfo Offline Mirror');
    const mirroredProbleme = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'probleme', 'index.html'),
      'utf8',
    );
    expect(mirroredProbleme).toContain('/_assets/asset-https-www-pbinfo-ro-static-site-css.css');
    expect(mirroredProbleme).not.toContain('cdn.jsdelivr.net');
    expect(mirroredProbleme).not.toContain('use.fontawesome.com');
    expect(mirroredProbleme).not.toContain('challenge-platform');
    expect(mirroredProbleme).not.toContain('gtag(');
    expect(
      readFileSync(
        join(snapshot.mirrorRoot, 'site', 'root', 'index.html'),
        'utf8',
      ),
    ).toContain('href="/probleme"');
  });

  test('rebuilds raw manifests from normalized page records when manifests are missing or corrupt', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-mirror-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-2026-03-11',
      scope: 'public',
      now: new Date('2026-03-11T00:00:00.000Z'),
    });
    mkdirSync(snapshot.rawPagesRoot, { recursive: true });
    mkdirSync(snapshot.rawAssetsRoot, { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'routes'), { recursive: true });

    writeFileSync(
      join(snapshot.rawPagesRoot, 'page-https-www-pbinfo-ro-probleme-1-demo.html'),
      '<html><head><link rel="stylesheet" href="https://www.pbinfo.ro/static/site.css"></head><body><h1>Demo</h1></body></html>',
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawAssetsRoot, 'asset-https-www-pbinfo-ro-static-site-css.css'),
      'body { color: blue; }',
      'utf8',
    );
    writeFileSync(snapshot.rawPagesManifestPath, '{', 'utf8');
    writeFileSync(snapshot.rawAssetsManifestPath, '{', 'utf8');

    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'page-demo.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/probleme/1/demo',
        bodyPath: 'raw-pages/page-https-www-pbinfo-ro-probleme-1-demo.html',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'asset-demo.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/static/site.css',
        bodyPath: 'raw-assets/asset-https-www-pbinfo-ro-static-site-css.css',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'routes', 'route-demo.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        route: '/probleme/1/demo',
        sourceUrl: 'https://www.pbinfo.ro/probleme/1/demo',
        sourceFile: 'page-https-www-pbinfo-ro-probleme-1-demo.html',
        template: 'problem',
        entityKey: 'problem:1',
      }, null, 2),
      'utf8',
    );

    const result = await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);

    expect(result.routesBuilt).toBe(1);
    expect(JSON.parse(readFileSync(snapshot.rawPagesManifestPath, 'utf8'))).toEqual({
      'https://www.pbinfo.ro/probleme/1/demo': 'page-https-www-pbinfo-ro-probleme-1-demo.html',
    });
    expect(JSON.parse(readFileSync(snapshot.rawAssetsManifestPath, 'utf8'))).toEqual({
      'https://www.pbinfo.ro/static/site.css': 'asset-https-www-pbinfo-ro-static-site-css.css',
    });
    expect(
      readFileSync(
        join(snapshot.mirrorRoot, 'site', 'probleme', '1', 'demo', 'index.html'),
        'utf8',
      ),
    ).toContain('/_assets/asset-https-www-pbinfo-ro-static-site-css.css');
  });
});
