import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { CrawlQueue, readCrawlQueueSnapshot } from '../../src/crawl/crawl-queue.js';
import type { CrawlQueueInput } from '../../src/types/crawl.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function queuePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pbinfo-queue-edges-'));
  tempDirs.push(dir);
  return join(dir, 'queue.sqlite');
}

describe('CrawlQueue edges', () => {
  test('enqueueMany is a no-op for an empty input list', () => {
    const queue = new CrawlQueue(queuePath());
    queue.enqueueMany([]);
    expect(queue.getSnapshot().items).toEqual([]);
  });

  test('reports zero counts for an empty queue and supports close()', () => {
    const queue = new CrawlQueue(queuePath());
    const snapshot = queue.getSnapshot();
    expect(snapshot).toMatchObject({ pending: 0, completed: 0, inProgress: 0, items: [] });
    expect(() => queue.close()).not.toThrow();
  });

  test('completion without metadata stores null hash and status', () => {
    const queue = new CrawlQueue(queuePath());
    queue.enqueueMany([{ key: 'k', url: 'https://x/', kind: 'public-page' }]);
    const claimed = queue.claimNext(new Date('2026-03-10T00:00:00.000Z'));
    queue.complete(claimed!.id, {});
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      contentHash: undefined,
      httpStatus: undefined,
    });
  });

  test('rolls back and rethrows when an insert violates a constraint', () => {
    const queue = new CrawlQueue(queuePath());
    const bad = [{ url: 'https://x/', kind: 'public-page' }] as unknown as CrawlQueueInput[];
    expect(() => queue.enqueueMany(bad)).toThrow();
    expect(queue.getSnapshot().items).toEqual([]);
  });

  test('readCrawlQueueSnapshot returns empty counts for a missing database', () => {
    expect(readCrawlQueueSnapshot(queuePath())).toEqual({
      pending: 0,
      completed: 0,
      inProgress: 0,
      items: [],
    });
  });

  test('readCrawlQueueSnapshot reads an existing database read-only', () => {
    const path = queuePath();
    const queue = new CrawlQueue(path);
    queue.enqueueMany([{ key: 'k', url: 'https://x/', kind: 'public-page' }]);
    const snapshot = readCrawlQueueSnapshot(path);
    expect(snapshot.pending).toBe(1);
    expect(snapshot.items[0]?.key).toBe('k');
  });
});
