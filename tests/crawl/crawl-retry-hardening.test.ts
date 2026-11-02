import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot, buildQueuePath } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { ArchiveCrawler, isRetryableHttpStatus } from '../../src/crawl/archive-crawler.js';
import { CrawlQueue } from '../../src/crawl/crawl-queue.js';
import { getCrawlStatusWorkflow } from '../../src/workflows/crawl-workflow.js';
import { getCrawlStatus } from '../../src/workflows/snapshot-workflow.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-retry-hardening-'));
  mkdirSync(join(root, '.local'), { recursive: true });
  tempDirs.push(root);
  const config = loadLocalConfig(root);
  const snapshot = prepareSnapshot(config, {
    snapshotId: 'snapshot-20260310T000000Z',
    scope: 'all',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });

  return {
    root,
    config,
    snapshot,
    queuePath: join(root, '.local', 'queue.sqlite'),
  };
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

describe('crawl retry hardening', () => {
  test('classifies retryable HTTP statuses', () => {
    expect(isRetryableHttpStatus(200)).toBe(false);
    expect(isRetryableHttpStatus(301)).toBe(false);
    expect(isRetryableHttpStatus(404)).toBe(false);
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(500)).toBe(true);
    expect(isRetryableHttpStatus(502)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
    expect(isRetryableHttpStatus(504)).toBe(true);
  });

  test('requeues HTTP 429 responses with backoff instead of archiving them', async () => {
    const workspace = createWorkspace();
    const url = 'https://www.pbinfo.ro/probleme';
    const queue = new CrawlQueue(workspace.queuePath);
    queue.enqueueMany([{ key: `page:${url}`, url, kind: 'public-page' }]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
      fetchImpl: async () => htmlResponse('<html><body>prea multe cereri</body></html>', 429),
      retryDelayMs: 30_000,
    });

    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);

    const snapshot = queue.getSnapshot();
    expect(snapshot.completed).toBe(0);
    expect(snapshot.pending).toBe(1);
    expect(snapshot.failed).toBe(0);
    expect(snapshot.items[0]?.lastError).toBe('http 429');
    expect(snapshot.items[0]?.visibleAt).toBe('2026-03-10T00:00:30.000Z');
  });

  test('requeues HTTP 500 responses with backoff instead of archiving them', async () => {
    const workspace = createWorkspace();
    const url = 'https://www.pbinfo.ro/probleme';
    const queue = new CrawlQueue(workspace.queuePath);
    queue.enqueueMany([{ key: `page:${url}`, url, kind: 'public-page' }]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
      fetchImpl: async () => htmlResponse('<html><body>server error</body></html>', 500),
      retryDelayMs: 30_000,
    });

    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);

    const snapshot = queue.getSnapshot();
    expect(snapshot.completed).toBe(0);
    expect(snapshot.pending).toBe(1);
    expect(snapshot.items[0]?.lastError).toBe('http 500');
  });

  test('archives HTTP 404 pages truthfully as completed dead ends', async () => {
    const workspace = createWorkspace();
    const url = 'https://www.pbinfo.ro/probleme-inexistente';
    const queue = new CrawlQueue(workspace.queuePath);
    queue.enqueueMany([{ key: `page:${url}`, url, kind: 'public-page' }]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
      fetchImpl: async () => htmlResponse('<html><body>Nu exista</body></html>', 404),
      retryDelayMs: 30_000,
    });

    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);

    const snapshot = queue.getSnapshot();
    expect(snapshot.completed).toBe(1);
    expect(snapshot.pending).toBe(0);
    expect(snapshot.items[0]?.httpStatus).toBe(404);
  });

  test('parks an item in the terminal failed status after maxAttempts', async () => {
    const workspace = createWorkspace();
    const url = 'https://www.pbinfo.ro/probleme';
    const queue = new CrawlQueue(workspace.queuePath);
    queue.enqueueMany([{ key: `page:${url}`, url, kind: 'public-page' }]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
      retryDelayMs: 30_000,
      maxAttempts: 2,
    });

    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);
    await expect(crawler.processNext(new Date('2026-03-10T00:00:30.000Z'))).resolves.toBe(true);

    let snapshot = queue.getSnapshot();
    expect(snapshot.pending).toBe(0);
    expect(snapshot.failed).toBe(1);
    expect(snapshot.items[0]?.status).toBe('failed');
    expect(snapshot.items[0]?.lastError).toBe('fetch failed');

    // The failed item is never claimable again, so the worker drains.
    await expect(crawler.processNext(new Date('2026-03-10T01:00:00.000Z'))).resolves.toBe(false);
    snapshot = queue.getSnapshot();
    expect(snapshot.failed).toBe(1);
    expect(snapshot.items[0]?.attemptCount).toBe(2);
  });

  test('fail() without maxAttempts keeps requeueing as pending for compatibility', () => {
    const workspace = createWorkspace();
    const queue = new CrawlQueue(workspace.queuePath);
    queue.enqueueMany([
      { key: 'page:https://www.pbinfo.ro/', url: 'https://www.pbinfo.ro/', kind: 'public-page' },
    ]);

    const claimed = queue.claimNext(new Date('2026-03-10T00:00:00.000Z'));
    expect(claimed).not.toBeNull();

    queue.fail(claimed!.id, {
      errorMessage: 'boom',
      nextVisibleAt: '2026-03-10T00:01:00.000Z',
    });

    const snapshot = queue.getSnapshot();
    expect(snapshot.pending).toBe(1);
    expect(snapshot.failed).toBe(0);
    expect(snapshot.items[0]?.lastError).toBe('boom');
  });

  test('crawl status surfaces the failed counter and failed items as recent failures', () => {
    const workspace = createWorkspace();
    const queuePath = buildQueuePath(
      join(workspace.root, '.local'),
      workspace.snapshot.snapshotId,
    );
    const queue = new CrawlQueue(queuePath);
    queue.enqueueMany([
      { key: 'page:https://www.pbinfo.ro/probleme', url: 'https://www.pbinfo.ro/probleme', kind: 'public-page' },
    ]);

    const claimed = queue.claimNext(new Date('2026-03-10T00:00:00.000Z'));
    queue.claimNext(new Date('2026-03-10T00:00:00.000Z'));
    queue.fail(claimed!.id, {
      errorMessage: 'fetch failed',
      nextVisibleAt: '2026-03-10T00:01:00.000Z',
      maxAttempts: 1,
    });

    const workflowStatus = getCrawlStatusWorkflow(workspace.root, workspace.snapshot.snapshotId);
    expect(workflowStatus.failed).toBe(1);
    expect(workflowStatus.pending).toBe(0);
    expect(workflowStatus.recentFailures[0]).toMatchObject({
      url: 'https://www.pbinfo.ro/probleme',
      lastError: 'fetch failed',
    });

    const cliStatus = getCrawlStatus(workspace.root, workspace.snapshot.snapshotId);
    expect(cliStatus.failed).toBe(1);
    expect(cliStatus.recentFailures[0]).toMatchObject({
      key: 'page:https://www.pbinfo.ro/probleme',
    });
  });
});
