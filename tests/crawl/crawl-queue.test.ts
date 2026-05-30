import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { CrawlQueue, readCrawlQueueSnapshot } from '../../src/crawl/crawl-queue.js';

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

  test('prioritizes evaluation-detail work ahead of additional list pagination', () => {
    const queue = createQueue();

    queue.enqueueMany([
      {
        key: 'official-source-list:https://www.pbinfo.ro/solutii/user/silviu/problema/10/suma-cifrelor?start=50',
        url: 'https://www.pbinfo.ro/solutii/user/silviu/problema/10/suma-cifrelor?start=50',
        kind: 'official-source-list',
      },
      {
        key: 'official-evaluation:63785797',
        url: 'https://www.pbinfo.ro/detalii-evaluare/63785797',
        kind: 'official-evaluation-detail',
      },
    ]);

    const claimed = queue.claimNext(new Date('2026-03-10T00:00:00.000Z'));
    expect(claimed?.key).toBe('official-evaluation:63785797');
  });

  test('reads an empty snapshot from a database path that does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pbinfo-queue-missing-'));
    tempDirs.push(dir);
    expect(readCrawlQueueSnapshot(join(dir, 'absent.sqlite'))).toEqual({
      pending: 0,
      completed: 0,
      inProgress: 0,
      items: [],
    });
  });

  test('rolls back the enqueue transaction and rethrows when an insert fails', () => {
    const queue = createQueue();

    expect(() =>
      queue.enqueueMany([
        {
          key: 'valid',
          url: 'https://www.pbinfo.ro/valid',
          kind: 'public-page',
        },
        // A null URL violates the NOT NULL column binding and aborts the batch.
        {
          key: 'invalid',
          url: undefined as unknown as string,
          kind: 'public-page',
        },
      ]),
    ).toThrow();

    // The rollback means neither item was persisted.
    expect(queue.getSnapshot().pending).toBe(0);
  });

  test('completes a work item without optional contentHash and httpStatus fields', () => {
    const queue = createQueue();

    queue.enqueueMany([
      {
        key: 'page:https://www.pbinfo.ro/partial-complete',
        url: 'https://www.pbinfo.ro/partial-complete',
        kind: 'public-page',
      },
    ]);

    const claimed = queue.claimNext(new Date('2026-03-10T00:00:00.000Z'));
    // Complete without contentHash or httpStatus → payload.contentHash ?? null and
    // payload.httpStatus ?? null branches are exercised
    queue.complete(claimed!.id, {});
    const snapshot = queue.getSnapshot();
    expect(snapshot.completed).toBe(1);
    expect(snapshot.items[0]).toMatchObject({ status: 'completed', contentHash: undefined, httpStatus: undefined });
  });

  test('rolls back the claimNext transaction and rethrows when the UPDATE fails mid-transaction', () => {
    const queue = createQueue();

    // Enqueue a work item so there is a row to claim.
    queue.enqueueMany([
      {
        key: 'page:https://www.pbinfo.ro/tx-fail',
        url: 'https://www.pbinfo.ro/tx-fail',
        kind: 'public-page',
      },
    ]);

    // Use a raw DatabaseSync connection to install a BEFORE UPDATE trigger that raises
    // an error.  The trigger fires inside claimNext's BEGIN IMMEDIATE transaction after the
    // SELECT succeeds but before the COMMIT, exercising the catch(ROLLBACK) path at lines
    // 151-153 of crawl-queue.ts.
    const { DatabaseSync } = require('node:sqlite');
    const [dbDir] = tempDirs.slice(-1);
    const rawDb = new DatabaseSync(join(dbDir, 'queue.sqlite'));
    rawDb.exec(
      "CREATE TRIGGER block_claim_update BEFORE UPDATE ON crawl_queue BEGIN SELECT RAISE(ABORT, 'simulated index lock'); END;",
    );
    rawDb.close();

    expect(() =>
      queue.claimNext(new Date('2026-03-10T00:00:00.000Z')),
    ).toThrow(/simulated index lock/);

    // The row must still be pending after the rollback (not in_progress).
    expect(queue.getSnapshot().pending).toBe(1);
    expect(queue.getSnapshot().inProgress).toBe(0);
  });
});
