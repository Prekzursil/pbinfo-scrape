import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { exportRawArtifacts, prepareSnapshot, readArchiveCatalog } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { CrawlQueue } from '../../src/crawl/crawl-queue.js';
import {
  finalizeSnapshotWorkflow,
  getCrawlStatus,
} from '../../src/workflows/snapshot-workflow.js';

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
    const queue = new CrawlQueue(join(config.paths.localRoot, 'crawl-queues', 'status-snapshot.sqlite'));
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

  test('finalizes a drained snapshot, exports artifacts, and prunes noncanonical state', async () => {
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
    exportRawArtifacts(config, stale, config.artifacts.exportRoot, new Date('2026-03-09T01:00:00.000Z'));
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
    writeFileSync(join(config.paths.localRoot, 'crawl-queues', 'stale-snapshot.sqlite'), '', 'utf8');
    void stale;

    const result = await finalizeSnapshotWorkflow(workspaceRoot, 'canonical-snapshot');
    const catalog = readArchiveCatalog(config.paths.archiveRoot);

    expect(result.snapshotId).toBe('canonical-snapshot');
    expect(result.artifactManifestPath).toBe(canonical.artifactManifestPath);
    expect(existsSync(result.artifactManifestPath)).toBe(true);
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
    const queue = new CrawlQueue(join(config.paths.localRoot, 'crawl-queues', 'pending-snapshot.sqlite'));
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
