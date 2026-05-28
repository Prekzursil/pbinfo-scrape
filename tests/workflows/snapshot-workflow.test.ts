import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  exportRawArtifacts,
  prepareSnapshot,
  readArchiveCatalog,
} from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { CrawlQueue } from '../../src/crawl/crawl-queue.js';
import { finalizeSnapshotWorkflow, getCrawlStatus } from '../../src/workflows/snapshot-workflow.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('snapshot workflow', () => {
  test('reports crawl status with recent failures and publish eligibility', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-snapshot-status-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'status-snapshot',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    mkdirSync(join(config.paths.localRoot, 'crawl-queues'), { recursive: true });
    const queue = new CrawlQueue(
      join(config.paths.localRoot, 'crawl-queues', 'status-snapshot.sqlite'),
    );
    queue.enqueueMany([
      {
        key: 'page:https://www.pbinfo.ro/problem',
        url: 'https://www.pbinfo.ro/problem',
        kind: 'public-page',
      },
    ]);
    const claimed = queue.claimNext(new Date('2026-03-10T00:01:00.000Z'));
    expect(claimed).toBeTruthy();
    queue.fail(claimed!.id, {
      errorMessage: 'temporarily unavailable',
      nextVisibleAt: '2026-03-10T00:06:00.000Z',
    });
    void snapshot;

    const status = getCrawlStatus(workspaceRoot, 'status-snapshot');

    expect(status).toMatchObject({
      snapshotId: 'status-snapshot',
      pending: 1,
      completed: 0,
      inProgress: 0,
      publishEligible: false,
    });
    expect(status.recentFailures).toEqual([
      expect.objectContaining({
        key: 'page:https://www.pbinfo.ro/problem',
        lastError: 'temporarily unavailable',
      }),
    ]);
  });

  test('finalizes a drained snapshot without promoting canonical state by default', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-snapshot-finalize-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const canonical = prepareSnapshot(config, {
      snapshotId: 'canonical-snapshot',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const stale = prepareSnapshot(config, {
      snapshotId: 'stale-snapshot',
      scope: 'all',
      now: new Date('2026-03-09T00:00:00.000Z'),
    });
    writeFileSync(
      join(stale.rawPagesRoot, 'page-https-www-pbinfo-ro-stale.html'),
      '<html><body><h1>Stale</h1></body></html>',
      'utf8',
    );
    writeFileSync(
      stale.rawPagesManifestPath,
      JSON.stringify({
        'https://www.pbinfo.ro/stale': 'page-https-www-pbinfo-ro-stale.html',
      }),
      'utf8',
    );
    exportRawArtifacts(
      config,
      stale,
      config.artifacts.exportRoot,
      new Date('2026-03-09T01:00:00.000Z'),
    );
    mkdirSync(join(canonical.normalizedRoot, 'pages'), { recursive: true });
    writeFileSync(
      join(canonical.normalizedRoot, 'pages', 'root.json'),
      JSON.stringify({
        snapshotId: 'canonical-snapshot',
        url: 'https://www.pbinfo.ro/',
        kind: 'public-page',
        httpStatus: 200,
        contentType: 'text/html',
        bodyPath: 'raw-pages/page-https-www-pbinfo-ro-root.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }),
      'utf8',
    );
    writeFileSync(
      join(canonical.rawPagesRoot, 'page-https-www-pbinfo-ro-root.html'),
      '<html><body><h1>PBInfo</h1></body></html>',
      'utf8',
    );
    writeFileSync(
      canonical.rawPagesManifestPath,
      JSON.stringify({
        'https://www.pbinfo.ro/': 'page-https-www-pbinfo-ro-root.html',
      }),
      'utf8',
    );
    mkdirSync(join(config.paths.localRoot, 'crawl-queues'), { recursive: true });
    writeFileSync(
      join(config.paths.localRoot, 'crawl-queues', 'stale-snapshot.sqlite'),
      '',
      'utf8',
    );
    void stale;

    const result = await finalizeSnapshotWorkflow(workspaceRoot, 'canonical-snapshot');
    const catalog = readArchiveCatalog(config.paths.archiveRoot);

    expect(result.snapshotId).toBe('canonical-snapshot');
    expect(result.artifactManifestPath).toBe(canonical.artifactManifestPath);
    expect(existsSync(result.artifactManifestPath)).toBe(true);
    expect(existsSync(stale.snapshotRoot)).toBe(true);
    expect(existsSync(join(config.paths.artifactsRoot, 'stale-snapshot'))).toBe(true);
    expect(existsSync(join(config.paths.localRoot, 'crawl-queues', 'stale-snapshot.sqlite'))).toBe(
      true,
    );
    expect(existsSync(join(config.artifacts.exportRoot, 'stale-snapshot'))).toBe(true);
    expect(existsSync(stale.artifactManifestPath)).toBe(true);
    expect(catalog.currentSnapshotId).toBe('canonical-snapshot');
    expect(catalog.canonicalSnapshotId).toBe('canonical-snapshot');
    expect(catalog.snapshots).toHaveLength(2);
    expect(result.coverageGates).toEqual({
      officialSourceGatePassed: true,
      solvedUserSourceGatePassed: true,
    });
    expect(existsSync(result.coverageGapReportPath)).toBe(true);
  });

  test('promotes a finalized snapshot and prunes noncanonical state when requested', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-snapshot-promote-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const canonical = prepareSnapshot(config, {
      snapshotId: 'canonical-snapshot',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const stale = prepareSnapshot(config, {
      snapshotId: 'stale-snapshot',
      scope: 'all',
      now: new Date('2026-03-09T00:00:00.000Z'),
    });
    writeFileSync(
      join(stale.rawPagesRoot, 'page-https-www-pbinfo-ro-stale.html'),
      '<html><body><h1>Stale</h1></body></html>',
      'utf8',
    );
    writeFileSync(
      stale.rawPagesManifestPath,
      JSON.stringify({
        'https://www.pbinfo.ro/stale': 'page-https-www-pbinfo-ro-stale.html',
      }),
      'utf8',
    );
    exportRawArtifacts(
      config,
      stale,
      config.artifacts.exportRoot,
      new Date('2026-03-09T01:00:00.000Z'),
    );
    mkdirSync(join(canonical.normalizedRoot, 'pages'), { recursive: true });
    writeFileSync(
      join(canonical.normalizedRoot, 'pages', 'root.json'),
      JSON.stringify({
        snapshotId: 'canonical-snapshot',
        url: 'https://www.pbinfo.ro/',
        kind: 'public-page',
        httpStatus: 200,
        contentType: 'text/html',
        bodyPath: 'raw-pages/page-https-www-pbinfo-ro-root.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }),
      'utf8',
    );
    writeFileSync(
      join(canonical.rawPagesRoot, 'page-https-www-pbinfo-ro-root.html'),
      '<html><body><h1>PBInfo</h1></body></html>',
      'utf8',
    );
    writeFileSync(
      canonical.rawPagesManifestPath,
      JSON.stringify({
        'https://www.pbinfo.ro/': 'page-https-www-pbinfo-ro-root.html',
      }),
      'utf8',
    );
    mkdirSync(join(config.paths.localRoot, 'crawl-queues'), { recursive: true });
    writeFileSync(
      join(config.paths.localRoot, 'crawl-queues', 'stale-snapshot.sqlite'),
      '',
      'utf8',
    );

    const result = await finalizeSnapshotWorkflow(workspaceRoot, 'canonical-snapshot', {
      promote: true,
    });
    const catalog = readArchiveCatalog(config.paths.archiveRoot);

    expect(result.snapshotId).toBe('canonical-snapshot');
    expect(existsSync(stale.snapshotRoot)).toBe(false);
    expect(existsSync(join(config.paths.artifactsRoot, 'stale-snapshot'))).toBe(false);
    expect(existsSync(join(config.paths.localRoot, 'crawl-queues', 'stale-snapshot.sqlite'))).toBe(
      false,
    );
    expect(existsSync(join(config.artifacts.exportRoot, 'stale-snapshot'))).toBe(false);
    expect(existsSync(stale.artifactManifestPath)).toBe(false);
    expect(catalog.currentSnapshotId).toBe('canonical-snapshot');
    expect(catalog.canonicalSnapshotId).toBe('canonical-snapshot');
    expect(catalog.snapshots).toHaveLength(1);
  });

  test('fails finalization when solved-by-you problems are missing archived user sources', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-snapshot-coverage-gates-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            userHandle: 'Prekzursil',
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'gate-snapshot',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });

    const problemUrl = 'https://www.pbinfo.ro/probleme/1/sum';
    const problemSolutionUrl =
      'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-solutie.php?id=1';
    const userSolutionsUrl = 'https://www.pbinfo.ro/solutii/user/Prekzursil';
    const evaluationUrl = 'https://www.pbinfo.ro/detalii-evaluare/70000001';

    writeFileSync(
      join(snapshot.rawPagesRoot, 'problem-1.html'),
      `
        <html><body>
          <table>
            <tr><th>Clasa</th></tr>
            <tr><td>9</td></tr>
          </table>
          <h1><a href="/probleme/1/sum">Sum</a></h1>
        </body></html>
      `,
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawPagesRoot, 'problem-1-solution.html'),
      `
        <html><body>
          <div class="alert alert-danger">Soluția oficială nu este publică.</div>
        </body></html>
      `,
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawPagesRoot, 'user-solutions.html'),
      `
        <html><body>
          <div class="bold mb-3">1 soluții respectă criteriile.</div>
          <table>
            <tr>
              <td><a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a></td>
              <td><a href="/probleme/1/sum">sum</a></td>
              <td><a href="/detalii-evaluare/70000001">Evaluare finalizată</a></td>
            </tr>
          </table>
        </body></html>
      `,
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawPagesRoot, 'evaluation-70000001.html'),
      `
        <div id="detalii">
          <table class="table">
            <tr>
              <th>Problema</th><td><a href="/probleme/1/sum">Sum</a></td>
              <th>Utilizator</th><td><a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a></td>
            </tr>
            <tr>
              <th>Limbaj</th><td>C++</td>
              <th>Scor/rezultat</th><td>100 puncte</td>
            </tr>
          </table>
        </div>
        <div id="evaluare">
          <table class="table">
            <tr>
              <th>Test</th>
              <th>Scor posibil</th>
              <th>Scor obținut</th>
              <th>Mesaj evaluare</th>
            </tr>
            <tr>
              <td>1</td>
              <td>10</td>
              <td>10</td>
              <td>OK.</td>
            </tr>
          </table>
        </div>
      `,
      'utf8',
    );
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify(
        {
          [problemUrl]: 'problem-1.html',
          [problemSolutionUrl]: 'problem-1-solution.html',
          [userSolutionsUrl]: 'user-solutions.html',
          [evaluationUrl]: 'evaluation-70000001.html',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, JSON.stringify({}, null, 2), 'utf8');

    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'problem-1.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          url: problemUrl,
          kind: 'public-page',
          httpStatus: 200,
          contentType: 'text/html',
          bodyPath: 'raw-pages/problem-1.html',
          fetchedAt: '2026-03-10T00:00:00.000Z',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'problem-1-solution.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          url: problemSolutionUrl,
          kind: 'problem-solution',
          httpStatus: 200,
          contentType: 'text/html',
          bodyPath: 'raw-pages/problem-1-solution.html',
          fetchedAt: '2026-03-10T00:00:00.000Z',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'user-solutions.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          url: userSolutionsUrl,
          kind: 'user-solutions',
          httpStatus: 200,
          contentType: 'text/html',
          bodyPath: 'raw-pages/user-solutions.html',
          fetchedAt: '2026-03-10T00:00:00.000Z',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'evaluation.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          url: evaluationUrl,
          kind: 'evaluation-detail',
          httpStatus: 200,
          contentType: 'text/html',
          bodyPath: 'raw-pages/evaluation-70000001.html',
          fetchedAt: '2026-03-10T00:00:00.000Z',
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(finalizeSnapshotWorkflow(workspaceRoot, 'gate-snapshot')).rejects.toThrow(
      /solved-by-you user sources missing/i,
    );
  });

  test('refuses to finalize a snapshot that still has pending queue work', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-snapshot-pending-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    prepareSnapshot(config, {
      snapshotId: 'pending-snapshot',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    mkdirSync(join(config.paths.localRoot, 'crawl-queues'), { recursive: true });
    const queue = new CrawlQueue(
      join(config.paths.localRoot, 'crawl-queues', 'pending-snapshot.sqlite'),
    );
    queue.enqueueMany([
      {
        key: 'page:https://www.pbinfo.ro/',
        url: 'https://www.pbinfo.ro/',
        kind: 'public-page',
      },
    ]);

    await expect(finalizeSnapshotWorkflow(workspaceRoot, 'pending-snapshot')).rejects.toThrow(
      /not drained yet/i,
    );
  });
});
