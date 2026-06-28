import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { ArchiveCrawler } from '../../src/crawl/archive-crawler.js';
import { CrawlQueue } from '../../src/crawl/crawl-queue.js';
import type { BrowserCapture } from '../../src/crawl/browser-capture.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('ArchiveCrawler browser capture failures', () => {
  test('tolerates a browser capture that throws and still archives the page', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-browser-fail-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'browser-fail',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const queue = new CrawlQueue(join(config.paths.localRoot, 'crawl-queues', 'browser-fail.sqlite'));
    queue.enqueueMany([
      { key: 'page:https://www.pbinfo.ro/probleme', url: 'https://www.pbinfo.ro/probleme', kind: 'public-page' },
    ]);

    const browserCapture: BrowserCapture = {
      captureHtml: async () => {
        throw new Error('browser crashed');
      },
    } as unknown as BrowserCapture;

    const crawler = new ArchiveCrawler({
      config,
      snapshot,
      queue,
      browserCapture,
      fetchImpl: (async () =>
        new Response('<html><body><h1>List</h1></body></html>', {
          headers: { 'content-type': 'text/html' },
        })) as typeof fetch,
    });

    await crawler.processNext(new Date('2026-03-10T00:00:00.000Z'));
    queue.close();

    expect(
      existsSync(join(snapshot.rawPagesRoot, 'page-https-www-pbinfo-ro-probleme.html')),
    ).toBe(true);
  });

  test('returns false when the queue has no claimable item', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-empty-queue-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'empty-queue',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const queue = new CrawlQueue(join(config.paths.localRoot, 'crawl-queues', 'empty-queue.sqlite'));

    const crawler = new ArchiveCrawler({
      config,
      snapshot,
      queue,
      fetchImpl: (async () => new Response('unused')) as typeof fetch,
    });

    const handled = await crawler.processNext(new Date('2026-03-10T00:00:00.000Z'));
    queue.close();

    expect(handled).toBe(false);
  });

  test('records a non-Error fetch rejection as a string failure reason', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-fetch-reject-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'fetch-reject',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const queue = new CrawlQueue(join(config.paths.localRoot, 'crawl-queues', 'fetch-reject.sqlite'));
    queue.enqueueMany([
      { key: 'page:https://www.pbinfo.ro/probleme', url: 'https://www.pbinfo.ro/probleme', kind: 'public-page' },
    ]);

    const crawler = new ArchiveCrawler({
      config,
      snapshot,
      queue,
      // Reject with a bare string (not an Error) to exercise the String(error) fallback.
      fetchImpl: (() => Promise.reject('network exploded')) as unknown as typeof fetch,
    });

    const handled = await crawler.processNext(new Date('2026-03-10T00:00:00.000Z'));
    const pending = queue.claimNext(new Date('2026-03-10T01:00:00.000Z'));
    queue.close();

    expect(handled).toBe(true);
    expect(pending?.lastError).toBe('network exploded');
  });

  test('archives a non-HTML asset that carries no content-type header', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-asset-notype-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'asset-notype',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const queue = new CrawlQueue(join(config.paths.localRoot, 'crawl-queues', 'asset-notype.sqlite'));
    queue.enqueueMany([
      { key: 'asset:https://www.pbinfo.ro/static/logo.bin', url: 'https://www.pbinfo.ro/static/logo.bin', kind: 'public-asset' },
    ]);

    const crawler = new ArchiveCrawler({
      config,
      snapshot,
      queue,
      // A binary asset with a non-HTML content-type drives the raw-asset archival branch.
      fetchImpl: (async () =>
        new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
          headers: { 'content-type': 'image/png' },
        })) as typeof fetch,
    });

    const handled = await crawler.processNext(new Date('2026-03-10T00:00:00.000Z'));
    queue.close();

    expect(handled).toBe(true);
    expect(readdirSync(snapshot.rawAssetsRoot).length).toBeGreaterThan(0);
  });
});
