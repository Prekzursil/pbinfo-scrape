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

    expect(result.routesBuilt).toBe(3);
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
        route: '/archive/coverage/',
        template: 'coverage-index',
        entityKey: 'archive:coverage',
        mirrorFile: 'site/archive/coverage/index.html',
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
    expect(
      readFileSync(
        join(snapshot.mirrorRoot, 'site', 'archive', 'coverage', 'index.html'),
        'utf8',
      ),
    ).toContain('Archive coverage');
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

    expect(result.routesBuilt).toBe(2);
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

  test('adds a coverage index route and injects truthful archive coverage badges into problem pages', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-mirror-coverage-'));
    tempDirs.push(workspaceRoot);

    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            userHandle: 'Prekzursil',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'acceptance-20260310b',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    mkdirSync(snapshot.rawPagesRoot, { recursive: true });
    mkdirSync(snapshot.rawAssetsRoot, { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'evaluations'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'rankings', 'problems'), {
      recursive: true,
    });
    mkdirSync(join(snapshot.normalizedRoot, 'sources'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'user-solutions'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'routes'), { recursive: true });

    writeFileSync(
      join(snapshot.rawPagesRoot, 'page-problem-3716.html'),
      '<html><head><title>Crossword</title></head><body><main><h1>Crossword</h1><p>Statement</p></main></body></html>',
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawPagesRoot, 'page-profile.html'),
      '<html><body><h1>Prekzursil</h1></body></html>',
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawPagesRoot, 'page-evaluation.html'),
      '<html><body><h1>Evaluation 63332367</h1></body></html>',
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'problem-page.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/probleme/3716/crossword',
        kind: 'public-page',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-3716.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'statement-page.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-enunt.php?id=3716',
        kind: 'problem-statement',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-3716.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'solution-page.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-solutie.php?id=3716',
        kind: 'problem-solution',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-3716.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'tests-page.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-teste.php?id=3716',
        kind: 'problem-tests',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-3716.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'profile-page.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/profil/Prekzursil',
        kind: 'user-profile',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-profile.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'evaluation-page.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/detalii-evaluare/63332367',
        kind: 'evaluation-detail',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-evaluation.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-3716.json'),
      JSON.stringify(
        {
          id: 3716,
          slug: 'crossword',
          name: 'Crossword',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/3716/crossword',
          grade: 11,
          categoryChain: [],
          tags: ['strings'],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'visible',
          editorial: {
            availability: 'visible',
            artifactPath: 'raw-pages/page-problem-3716.html',
          },
          officialSolutions: {
            cpp: '// editorial snippet',
          },
          officialSourceIds: {},
          visibleTests: [],
          linkedAssets: [],
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/3716/crossword',
          metadata: {},
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-63332367.json'),
      JSON.stringify(
        {
          evaluationId: 63332367,
          problemId: 3716,
          problemSlug: 'crossword',
          problemName: 'Crossword',
          language: 'c',
          user: 'Andrei Visalon (Prekzursil)',
          score: 100,
          verdictSummary: 'accepted',
          sourceAvailable: false,
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-10T00:00:00.000Z',
          provenance: ['https://www.pbinfo.ro/detalii-evaluare/63332367'],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'rankings', 'best-submissions.json'),
      JSON.stringify(
        {
          generatedAt: '2026-03-10T00:00:00.000Z',
          problems: [
            {
              problemId: 3716,
              bestUserOverallEvaluationId: 63332367,
              bestUserPerLanguage: { c: 63332367 },
              bestOfficialPerLanguage: {},
              orderedUserEvaluationIds: [63332367],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'rankings', 'problems', 'problem-3716.json'),
      JSON.stringify(
        {
          problemId: 3716,
          bestUserOverallEvaluationId: 63332367,
          bestUserPerLanguage: { c: 63332367 },
          bestOfficialPerLanguage: {},
          orderedUserEvaluationIds: [63332367],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
      JSON.stringify(
        {
          user: 'Prekzursil',
          entries: [
            {
              user: 'Andrei Visalon (Prekzursil)',
              problemId: 3716,
              problemSlug: 'crossword',
              problemName: 'Crossword',
              evaluationId: 63332367,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'routes', 'route-problem.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          route: '/probleme/3716/crossword',
          sourceUrl: 'https://www.pbinfo.ro/probleme/3716/crossword',
          sourceFile: 'page-problem-3716.html',
          template: 'problem',
          entityKey: 'problem:3716',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'routes', 'route-profile.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          route: '/profil/Prekzursil',
          sourceUrl: 'https://www.pbinfo.ro/profil/Prekzursil',
          sourceFile: 'page-profile.html',
          template: 'user-profile',
          entityKey: 'user:Prekzursil',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'routes', 'route-evaluation.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          route: '/detalii-evaluare/63332367',
          sourceUrl: 'https://www.pbinfo.ro/detalii-evaluare/63332367',
          sourceFile: 'page-evaluation.html',
          template: 'evaluation',
          entityKey: 'evaluation:63332367',
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);

    expect(result.routesBuilt).toBe(4);
    const routes = JSON.parse(readFileSync(snapshot.routesManifestPath, 'utf8')) as Array<{
      route: string;
      template: string;
    }>;
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: '/archive/coverage/',
          template: 'coverage-index',
        }),
      ]),
    );

    const coverageHtml = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'archive', 'coverage', 'index.html'),
      'utf8',
    );
    expect(coverageHtml).toContain('Archive coverage');
    expect(coverageHtml).toContain('Crossword');
    expect(coverageHtml).toContain('Solved by archived handle');
    expect(coverageHtml).toContain('/probleme/3716/crossword');

    const problemHtml = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'probleme', '3716', 'crossword', 'index.html'),
      'utf8',
    );
    expect(problemHtml).toContain('Archive coverage');
    expect(problemHtml).toContain('Solved by archived handle');
    expect(problemHtml).toContain('Tests fragment archived');
    expect(problemHtml).toContain('Effective tests: 0');
    expect(problemHtml).toContain('Visible tests captured: 0');
    expect(problemHtml).toContain('Official source blocked: official-source-not-captured');
    expect(problemHtml).toContain('User source not archived');
    expect(problemHtml).toContain('New since baseline');
    expect(problemHtml).toContain('/archive/coverage/');
  });
});
