import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { CrawlQueue } from '../../src/crawl/crawl-queue.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createQueue(): CrawlQueue {
  const dir = mkdtempSync(join(tmpdir(), 'pbinfo-queue-'));
  tempDirs.push(dir);
  return new CrawlQueue(join(dir, 'queue.sqlite'));
}

describe('CrawlQueue', () => {
  test('claims pending work in FIFO order and persists completion metadata', () => {
    const queue = createQueue();

    queue.enqueueMany([
      {
        key: 'page:https://www.pbinfo.ro/',
        url: 'https://www.pbinfo.ro/',
        kind: 'public-page',
      },
      {
        key: 'page:https://www.pbinfo.ro/probleme',
        url: 'https://www.pbinfo.ro/probleme',
        kind: 'public-page',
      },
    ]);

    const claimed = queue.claimNext(new Date('2026-03-10T00:00:00.000Z'));
    expect(claimed?.key).toBe('page:https://www.pbinfo.ro/');

    queue.complete(claimed!.id, {
      contentHash: 'sha256:abc',
      httpStatus: 200,
    });

    const snapshot = queue.getSnapshot();
    expect(snapshot.completed).toBe(1);
    expect(snapshot.pending).toBe(1);
    expect(snapshot.items[0]).toMatchObject({
      key: 'page:https://www.pbinfo.ro/',
      status: 'completed',
      contentHash: 'sha256:abc',
      httpStatus: 200,
    });
  });

  test('backs off failed work until its retry window opens', () => {
    const queue = createQueue();

    queue.enqueueMany([
      {
        key: 'page:https://www.pbinfo.ro/solutii/user/Prekzursil',
        url: 'https://www.pbinfo.ro/solutii/user/Prekzursil',
        kind: 'user-solutions',
      },
    ]);

    const firstClaim = queue.claimNext(new Date('2026-03-10T00:00:00.000Z'));
    expect(firstClaim?.key).toBe('page:https://www.pbinfo.ro/solutii/user/Prekzursil');

    queue.fail(firstClaim!.id, {
      errorMessage: 'temporarily unavailable',
      nextVisibleAt: '2026-03-10T00:05:00.000Z',
    });

    expect(queue.claimNext(new Date('2026-03-10T00:04:59.000Z'))).toBeNull();

    const retryClaim = queue.claimNext(new Date('2026-03-10T00:05:01.000Z'));
    expect(retryClaim?.attemptCount).toBe(2);
    expect(retryClaim?.lastError).toBe('temporarily unavailable');
  });

  test('requeues stranded in-progress work after an interrupted crawl', () => {
    const queue = createQueue();

    queue.enqueueMany([
      {
        key: 'page:https://www.pbinfo.ro/detalii-evaluare/1',
        url: 'https://www.pbinfo.ro/detalii-evaluare/1',
        kind: 'evaluation-detail',
      },
    ]);

    const claimed = queue.claimNext(new Date('2026-03-10T00:00:00.000Z'));
    expect(claimed?.status).toBe('in_progress');

    const recovered = queue.requeueInProgress();
    const snapshot = queue.getSnapshot();

    expect(recovered).toBe(1);
    expect(snapshot.inProgress).toBe(0);
    expect(snapshot.pending).toBe(1);
    expect(snapshot.items[0]).toMatchObject({
      status: 'pending',
      lastError: 'requeued after interrupted crawl',
    });
  });
});
