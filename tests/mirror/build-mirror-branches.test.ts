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

function bootstrapMirrorWorkspace(prefix: string) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(workspaceRoot);

  const config = loadLocalConfig(workspaceRoot);
  const snapshot = prepareSnapshot(config, {
    snapshotId: 'snap-mirror',
    scope: 'all',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });
  mkdirSync(snapshot.rawPagesRoot, { recursive: true });
  mkdirSync(snapshot.rawAssetsRoot, { recursive: true });
  mkdirSync(snapshot.normalizedRoot, { recursive: true });
  return { workspaceRoot, config, snapshot };
}

describe('buildMirrorArtifacts edge branches', () => {
  test('throws when a route record is missing a source file (no url to derive from)', async () => {
    const { workspaceRoot, snapshot } = bootstrapMirrorWorkspace('pbinfo-mirror-noroute-');
    const routesRoot = join(snapshot.normalizedRoot, 'routes');
    mkdirSync(routesRoot, { recursive: true });
    writeFileSync(
      join(routesRoot, 'route-1.json'),
      JSON.stringify({
        route: '/orphan',
        snapshotId: snapshot.snapshotId,
        sourceUrl: 'https://www.pbinfo.ro/orphan',
        template: 'raw-page',
        entityKey: '/orphan',
      }),
      'utf8',
    );
    writeFileSync(join(snapshot.rawPagesManifestPath), '{}', 'utf8');
    writeFileSync(join(snapshot.rawAssetsManifestPath), '{}', 'utf8');

    await expect(buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId)).rejects.toThrow(
      /missing a source file/,
    );
  });

  test('rebuilds raw manifests when normalized page records reference raw-assets paths', async () => {
    const { workspaceRoot, snapshot } = bootstrapMirrorWorkspace('pbinfo-mirror-asset-rebuild-');
    writeFileSync(
      join(snapshot.rawPagesRoot, 'page.html'),
      '<html><body><img src="https://www.pbinfo.ro/static/photo.png" /></body></html>',
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawAssetsRoot, 'asset-photo.png'),
      'png',
      'utf8',
    );
    const pagesDir = join(snapshot.normalizedRoot, 'pages');
    mkdirSync(pagesDir, { recursive: true });
    // Two records: one references raw-pages (page) and one raw-assets (asset).
    writeFileSync(
      join(pagesDir, 'page.json'),
      JSON.stringify({
        url: 'https://www.pbinfo.ro/page',
        bodyPath: 'raw-pages/page.html',
      }),
      'utf8',
    );
    writeFileSync(
      join(pagesDir, 'asset.json'),
      JSON.stringify({
        url: 'https://www.pbinfo.ro/static/photo.png',
        bodyPath: 'raw-assets/asset-photo.png',
      }),
      'utf8',
    );
    writeFileSync(
      join(pagesDir, 'missing.json'),
      JSON.stringify({ url: 'https://www.pbinfo.ro/missing' }),
      'utf8',
    );

    const result = await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);
    expect(result.routesBuilt).toBeGreaterThan(0);
    const pageManifest = JSON.parse(readFileSync(snapshot.rawPagesManifestPath, 'utf8')) as Record<
      string,
      string
    >;
    expect(pageManifest['https://www.pbinfo.ro/page']).toBe('page.html');
    const assetManifest = JSON.parse(readFileSync(snapshot.rawAssetsManifestPath, 'utf8')) as Record<
      string,
      string
    >;
    expect(assetManifest['https://www.pbinfo.ro/static/photo.png']).toBe('asset-photo.png');
  });

  test('strips dangerous script tags and rewrites assets via inline manifest', async () => {
    const { workspaceRoot, snapshot } = bootstrapMirrorWorkspace('pbinfo-mirror-rewrite-');
    writeFileSync(
      join(snapshot.rawPagesRoot, 'page.html'),
      `<html><head>
        <link rel="stylesheet" href="https://www.pbinfo.ro/static/site.css">
        <link rel="stylesheet" href="https://other.example/site.css">
        <script src="https://www.pbinfo.ro/static/site.js"></script>
        <script src="https://challenge.example/script.js"></script>
        <script>window.dataLayer = window.dataLayer || []; gtag('config','x');</script>
        <script>window.__CF$cv$params={r:'abc'};</script>
        <script>console.log('safe');</script>
      </head><body>
        <img src="https://www.pbinfo.ro/static/photo.png" />
        <a href="javascript:void(0)">Bad</a>
        <a href="#section">Anchor</a>
        <a href="https://other.example/">External</a>
        <a href="/probleme/123/sample">Internal</a>
      </body></html>`,
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawAssetsRoot, 'site-css.css'),
      'body{}',
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawAssetsRoot, 'site-js.js'),
      'console.log()',
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawAssetsRoot, 'photo.png'),
      'png',
      'utf8',
    );
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({ 'https://www.pbinfo.ro/page': 'page.html' }),
      'utf8',
    );
    writeFileSync(
      snapshot.rawAssetsManifestPath,
      JSON.stringify({
        'https://www.pbinfo.ro/static/site.css': 'site-css.css',
        'https://www.pbinfo.ro/static/site.js': 'site-js.js',
        'https://www.pbinfo.ro/static/photo.png': 'photo.png',
      }),
      'utf8',
    );

    await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);
    const mirrorIndex = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'page', 'index.html'),
      'utf8',
    );
    expect(mirrorIndex).toContain('/_assets/site-css.css');
    expect(mirrorIndex).toContain('/_assets/site-js.js');
    expect(mirrorIndex).toContain('/_assets/photo.png');
    expect(mirrorIndex).not.toContain('dataLayer');
    expect(mirrorIndex).not.toContain('__CF$cv$params');
    expect(mirrorIndex).not.toContain('challenge.example');
  });

  test('renders the coverage index HTML even when no coverage records exist', async () => {
    const { workspaceRoot, snapshot } = bootstrapMirrorWorkspace('pbinfo-mirror-empty-cov-');
    writeFileSync(
      join(snapshot.rawPagesRoot, 'page.html'),
      '<html><body></body></html>',
      'utf8',
    );
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({ 'https://www.pbinfo.ro/': 'page.html' }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);
    const coverageIndex = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'archive', 'coverage', 'index.html'),
      'utf8',
    );
    expect(coverageIndex).toContain('Archive coverage');
    expect(coverageIndex).toContain('coverage-search');
  });
});
