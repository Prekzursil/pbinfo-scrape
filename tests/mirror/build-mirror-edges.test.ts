import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { loadLocalConfig } from '../../src/config/local-config.js';
import { prepareSnapshot } from '../../src/archive/storage.js';
import {
  buildMirrorArtifacts,
  findSourceUrl,
  inferEntityKey,
  inferTemplate,
  readProblemIdFromEntityKey,
  readRouteRecords,
  rebuildRawManifests,
  renderCoverageIndex,
  rewriteMirrorHtml,
  routeToMirrorFile,
  safeResolve,
} from '../../src/mirror/build-mirror.js';
import { makeCoverageIndex, makeCoverageRecord } from '../_fixtures/coverage.js';

function setupSnapshot(): { workspaceRoot: string; rawPagesRoot: string; pagesRoot: string; routesRoot: string } {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-build-mirror-'));
  tempDirs.push(workspaceRoot);
  const config = loadLocalConfig(workspaceRoot);
  const snapshot = prepareSnapshot(config, { snapshotId: 'SNAP', scope: 'public', now: new Date() });
  const pagesRoot = join(snapshot.normalizedRoot, 'pages');
  const routesRoot = join(snapshot.normalizedRoot, 'routes');
  mkdirSync(pagesRoot, { recursive: true });
  mkdirSync(snapshot.rawPagesRoot, { recursive: true });
  return { workspaceRoot, rawPagesRoot: snapshot.rawPagesRoot, pagesRoot, routesRoot };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('build-mirror url helpers', () => {
  test('safeResolve rejects dangerous and malformed candidates', () => {
    const base = new URL('https://www.pbinfo.ro/page');
    expect(safeResolve(base, undefined)).toBeUndefined();
    expect(safeResolve(base, '   ')).toBeUndefined();
    expect(safeResolve(base, 'javascript:alert(1)')).toBeUndefined();
    expect(safeResolve(base, 'VBScript:x')).toBeUndefined();
    expect(safeResolve(base, 'data:text/html,x')).toBeUndefined();
    expect(safeResolve(base, '#anchor')).toBeUndefined();
    expect(safeResolve(base, 'http://[bad')).toBeUndefined();
    const resolved = safeResolve(base, '/probleme#frag');
    expect(resolved?.pathname).toBe('/probleme');
    expect(resolved?.hash).toBe('');
  });

  test('inferTemplate classifies known pbinfo url shapes', () => {
    expect(inferTemplate('https://www.pbinfo.ro/detalii-evaluare/55')).toBe('evaluation');
    expect(inferTemplate('https://www.pbinfo.ro/profil/alice')).toBe('user-profile');
    expect(inferTemplate('https://www.pbinfo.ro/solutii/user/alice')).toBe('user-profile');
    expect(inferTemplate('https://www.pbinfo.ro/probleme/1/sum')).toBe('problem');
    expect(inferTemplate('https://www.pbinfo.ro/despre')).toBe('raw-page');
  });

  test('inferEntityKey extracts entity identifiers with a path fallback', () => {
    expect(inferEntityKey('https://www.pbinfo.ro/probleme/1/sum')).toBe('problem:1');
    expect(inferEntityKey('https://www.pbinfo.ro/detalii-evaluare/55')).toBe('evaluation:55');
    expect(inferEntityKey('https://www.pbinfo.ro/profil/alice')).toBe('user:alice');
    expect(inferEntityKey('https://www.pbinfo.ro/despre')).toBe('/despre');
  });

  test('findSourceUrl reverse-maps the manifest', () => {
    const manifest = { 'https://x/a': 'a.html', 'https://x/b': 'b.html' };
    expect(findSourceUrl(manifest, 'b.html')).toBe('https://x/b');
    expect(findSourceUrl(manifest, 'missing.html')).toBeUndefined();
  });

  test('routeToMirrorFile sanitizes routes including the root and queries', () => {
    expect(routeToMirrorFile('/')).toBe('site/root/index.html');
    expect(routeToMirrorFile('')).toBe('site/root/index.html');
    expect(routeToMirrorFile('/probleme/1/su m')).toContain('site/probleme/1');
    expect(routeToMirrorFile('/probleme?start=10')).toMatch(/index-[0-9a-f]+\.html$/);
  });

  test('readProblemIdFromEntityKey parses problem keys and rejects others', () => {
    expect(readProblemIdFromEntityKey('problem:42')).toBe(42);
    expect(Number.isNaN(readProblemIdFromEntityKey('user:alice'))).toBe(true);
  });
});

describe('build-mirror manifest readers', () => {
  test('readRouteRecords returns an empty list for a missing directory', () => {
    expect(readRouteRecords(join(tmpdir(), 'pbinfo-no-routes-dir-xyz'))).toEqual([]);
  });

  test('rebuildRawManifests classifies page and asset bodies and skips bad records', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-rebuild-'));
    tempDirs.push(root);
    const pagesRoot = join(root, 'pages');
    mkdirSync(pagesRoot, { recursive: true });
    writeFileSync(join(pagesRoot, 'a.json'), JSON.stringify({ url: 'https://x/a', bodyPath: 'raw-pages/a.html' }), 'utf8');
    writeFileSync(join(pagesRoot, 'b.json'), JSON.stringify({ url: 'https://x/b.css', bodyPath: 'raw-assets/b.css' }), 'utf8');
    writeFileSync(join(pagesRoot, 'c.json'), JSON.stringify({ url: 'https://x/c' }), 'utf8');
    writeFileSync(join(pagesRoot, 'd.json'), JSON.stringify({ bodyPath: 'raw-pages/d.html' }), 'utf8');

    const manifests = rebuildRawManifests(root);
    expect(manifests.pageManifest).toEqual({ 'https://x/a': 'a.html' });
    expect(manifests.assetManifest).toEqual({ 'https://x/b.css': 'b.css' });
  });

  test('rebuildRawManifests tolerates a missing pages directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-rebuild-empty-'));
    tempDirs.push(root);
    expect(rebuildRawManifests(root)).toEqual({ pageManifest: {}, assetManifest: {} });
  });
});

describe('rewriteMirrorHtml', () => {
  test('rewrites assets and routes, removes third-party content, and injects coverage', () => {
    const html = `<html><head>
      <link rel="stylesheet" href="https://www.pbinfo.ro/static/site.css">
      <link rel="stylesheet" href="https://cdn.external.com/x.css">
      <script src="https://www.pbinfo.ro/app.js"></script>
      <script src="https://evil.com/x.js"></script>
      <script src="data:text/javascript,1"></script>
      <script>window.dataLayer = [];</script>
      <script>var a = 'challenge-platform';</script>
      <script>window.__CF$cv$params = {};</script>
      <script>gtag('config');</script>
      <script>console.log('keep me');</script>
    </head><body>
      <img src="https://www.pbinfo.ro/img.png">
      <img src="https://cdn.x.com/y.png">
      <source src="https://www.pbinfo.ro/v.mp4">
      <a href="https://www.pbinfo.ro/probleme">local</a>
      <a href="https://www.pbinfo.ro/other-page">local-unlisted</a>
      <a href="https://external.com/x">external</a>
      <a href="javascript:void(0)">js</a>
      <iframe src="x"></iframe>
      <form action="/login"><input></form>
    </body></html>`;
    const assetManifest = {
      'https://www.pbinfo.ro/static/site.css': 'site.css',
      'https://www.pbinfo.ro/app.js': 'app.js',
      'https://www.pbinfo.ro/img.png': 'img.png',
      'https://www.pbinfo.ro/v.mp4': 'v.mp4',
    };
    const pageManifest = { 'https://www.pbinfo.ro/probleme': 'probleme.html' };
    const record = makeCoverageRecord({
      problemId: 1,
      officialSourceArchived: true,
      officialSourceLanguages: ['cpp'],
      trustworthyUserSourceLanguages: ['cpp'],
      newSinceBaseline: true,
      notes: ['a note'],
    });

    const out = rewriteMirrorHtml(html, 'https://www.pbinfo.ro/page', pageManifest, assetManifest, record);
    expect(out).toContain('/_assets/site.css');
    expect(out).toContain('/_assets/app.js');
    expect(out).not.toContain('evil.com');
    expect(out).not.toContain('dataLayer');
    expect(out).toContain('keep me');
    expect(out).toContain('href="/probleme"');
    expect(out).not.toContain('<iframe');
    expect(out).toContain('archive-coverage-strip');
  });

  test('returns early when a coverage strip already exists', () => {
    const html = '<html><body><section class="archive-coverage-strip"></section></body></html>';
    const record = makeCoverageRecord({ problemId: 1 });
    const out = rewriteMirrorHtml(html, 'https://www.pbinfo.ro/p', {}, {}, record);
    expect(out.match(/archive-coverage-strip/g)).toHaveLength(1);
  });

  test('injects a strip for a blocked official source with archived user sources', () => {
    const record = makeCoverageRecord({
      problemId: 2,
      officialSourceArchived: false,
      officialSourceBlockedReason: 'editorial-hidden',
      userSourceArchived: true,
      newSinceBaseline: false,
      notes: [],
    });
    const out = rewriteMirrorHtml('<html><body></body></html>', 'https://www.pbinfo.ro/p', {}, {}, record);
    expect(out).toContain('Official source blocked: editorial-hidden');
    expect(out).toContain('User sources archived');
  });

  test('injects a strip for an unarchived problem with notes', () => {
    const record = makeCoverageRecord({
      problemId: 3,
      officialSourceArchived: false,
      userSourceArchived: false,
      notes: ['needs work'],
    });
    const out = rewriteMirrorHtml('<html><body></body></html>', 'https://www.pbinfo.ro/p', {}, {}, record);
    expect(out).toContain('Official source not archived');
    expect(out).toContain('User source not archived');
    expect(out).toContain('needs work');
  });
});

describe('renderCoverageIndex', () => {
  test('renders summary fallbacks when no coverage index is present', () => {
    const html = renderCoverageIndex('SNAP', undefined);
    expect(html).toContain('Canonical snapshot SNAP');
    expect(html).toContain('<strong>0</strong>');
  });

  test('renders rows for diverse coverage records', () => {
    const index = makeCoverageIndex([
      makeCoverageRecord({
        problemId: 1,
        name: 'Alpha',
        grade: 9,
        solvedByMe: true,
        testsFragmentArchived: true,
        officialSourceArchived: true,
        officialSourceLanguages: ['cpp'],
        trustworthyUserSourceLanguages: ['cpp'],
        bestUserOverallEvaluationId: 100,
        notes: ['note one'],
        editorialAvailability: 'visible',
      }),
      makeCoverageRecord({
        problemId: 2,
        name: 'Beta',
        grade: undefined,
        officialSourceArchived: false,
        officialSourceBlockedReason: 'editorial-hidden',
        userSourceArchived: true,
      }),
      (() => {
        const record = makeCoverageRecord({
          problemId: 3,
          name: 'Gamma',
          officialSourceArchived: false,
          userSourceArchived: false,
        });
        delete (record as { notes?: string[] }).notes;
        return record;
      })(),
    ]);
    const html = renderCoverageIndex('SNAP', index);
    expect(html).toContain('#1 Alpha');
    expect(html).toContain('Official source languages: cpp');
    expect(html).toContain('Official source blocked: editorial-hidden');
    expect(html).toContain('Official source not archived');
    expect(html).toContain('best eval');
    expect(html).toContain('<option value="9">9</option>');
  });
});

describe('buildMirrorArtifacts route resolution', () => {
  test('resolves route records by source url and source file, skipping empty records', async () => {
    const { workspaceRoot, rawPagesRoot, pagesRoot, routesRoot } = setupSnapshot();
    writeFileSync(join(rawPagesRoot, 'a.html'), '<html><body>a</body></html>', 'utf8');
    writeFileSync(join(rawPagesRoot, 'b.html'), '<html><body>b</body></html>', 'utf8');
    writeJson(join(pagesRoot, 'a.json'), { url: 'https://www.pbinfo.ro/a', bodyPath: 'raw-pages/a.html' });
    writeJson(join(pagesRoot, 'b.json'), { url: 'https://www.pbinfo.ro/b', bodyPath: 'raw-pages/b.html' });
    // e.html exists on disk but is not in the page manifest, so its source url
    // cannot be reverse-resolved and the rewriter falls back to a synthetic url.
    writeFileSync(join(rawPagesRoot, 'e.html'), '<html><body>e</body></html>', 'utf8');
    writeJson(join(routesRoot, 'r-a.json'), { route: '/a', sourceUrl: 'https://www.pbinfo.ro/a', template: 'raw-page', entityKey: '/a' });
    writeJson(join(routesRoot, 'r-b.json'), { route: '/b', sourceFile: 'b.html', template: 'raw-page', entityKey: '/b' });
    writeJson(join(routesRoot, 'r-e.json'), { route: '/e', sourceFile: 'e.html', template: 'raw-page', entityKey: '/e' });
    writeJson(join(routesRoot, 'r-empty.json'), { route: '/c', template: 'raw-page', entityKey: '/c' });

    const result = await buildMirrorArtifacts(workspaceRoot);
    expect(result.routesBuilt).toBe(4); // /a, /b, /e, coverage index
  });

  test('throws when a route record cannot resolve a source file', async () => {
    const { workspaceRoot, routesRoot } = setupSnapshot();
    writeJson(join(routesRoot, 'r.json'), { route: '/x', sourceUrl: 'https://www.pbinfo.ro/missing', template: 'raw-page', entityKey: '/x' });
    await expect(buildMirrorArtifacts(workspaceRoot)).rejects.toThrow(/missing a source file/);
  });

  test('throws when a route references a raw page that is absent on disk', async () => {
    const { workspaceRoot, routesRoot } = setupSnapshot();
    writeJson(join(routesRoot, 'r.json'), { route: '/d', sourceFile: 'gone.html', template: 'raw-page', entityKey: '/d' });
    await expect(buildMirrorArtifacts(workspaceRoot)).rejects.toThrow(/missing raw page/);
  });

  test('falls back to the page manifest and infers templates when no routes exist', async () => {
    const { workspaceRoot, rawPagesRoot, pagesRoot } = setupSnapshot();
    const entries = [
      { url: 'https://www.pbinfo.ro/probleme/1/sum', file: 'prob.html' },
      { url: 'https://www.pbinfo.ro/detalii-evaluare/5', file: 'eval.html' },
      { url: 'https://www.pbinfo.ro/profil/alice', file: 'prof.html' },
      { url: 'https://www.pbinfo.ro/despre', file: 'raw.html' },
    ];
    for (const [index, entry] of entries.entries()) {
      writeFileSync(join(rawPagesRoot, entry.file), '<html><body>x</body></html>', 'utf8');
      writeJson(join(pagesRoot, `p${index}.json`), { url: entry.url, bodyPath: `raw-pages/${entry.file}` });
    }
    const result = await buildMirrorArtifacts(workspaceRoot);
    expect(result.routesBuilt).toBe(entries.length + 1);
  });
});
