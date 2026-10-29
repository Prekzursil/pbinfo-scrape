import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  buildQueuePath,
  markSnapshotCompleted,
  prepareSnapshot,
} from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { persistOfficialSourceHarvest } from '../../src/crawl/archive-crawler.js';
import { CrawlQueue } from '../../src/crawl/crawl-queue.js';
import { getCrawlStatusWorkflow, resumeCrawlWorkflow } from '../../src/workflows/crawl-workflow.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-crawl-multi-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.local'), { recursive: true });
  writeFileSync(
    join(root, '.local', 'pbinfo.local.json'),
    JSON.stringify({ crawl: { crossCheckWithBrowser: false } }),
    'utf8',
  );
  return root;
}

describe('crawl workflow with several snapshots and failures', () => {
  test('reports every recent failure', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'STAT2', scope: 'public', now: new Date() });
    const queue = new CrawlQueue(buildQueuePath(config.paths.localRoot, 'STAT2'));
    queue.enqueueMany([
      { key: 'k1', url: 'https://x/1', kind: 'public-page' },
      { key: 'k2', url: 'https://x/2', kind: 'public-page' },
    ]);
    const first = queue.claimNext(new Date('2026-01-01T00:00:00Z'));
    queue.fail(first!.id, { errorMessage: 'one', nextVisibleAt: '2026-01-02T00:00:00Z' });
    const second = queue.claimNext(new Date('2026-01-01T00:01:00Z'));
    queue.fail(second!.id, { errorMessage: 'two', nextVisibleAt: '2026-01-02T00:00:00Z' });

    const status = getCrawlStatusWorkflow(root, 'STAT2');
    expect(status.recentFailures).toHaveLength(2);
  });

  test('resumes the newest in-progress snapshot when the current one is finished', async () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    prepareSnapshot(config, {
      snapshotId: 'OLDER',
      scope: 'public',
      now: new Date('2026-01-01T00:00:00Z'),
    });
    prepareSnapshot(config, {
      snapshotId: 'NEWER',
      scope: 'public',
      now: new Date('2026-01-02T00:00:00Z'),
    });
    prepareSnapshot(config, {
      snapshotId: 'DONE',
      scope: 'public',
      now: new Date('2026-01-03T00:00:00Z'),
    });
    markSnapshotCompleted(config, 'DONE');

    const result = await resumeCrawlWorkflow(root, { maxIterations: 0 });
    expect(result.snapshotId).toBe('NEWER');
  });
});

describe('persistOfficialSourceHarvest', () => {
  test('stores the qualifying evaluations once each, in ascending order', () => {
    const root = workspace();
    const config = loadLocalConfig(root);
    const layout = prepareSnapshot(config, { snapshotId: 'HARV', scope: 'all', now: new Date() });

    persistOfficialSourceHarvest(
      layout,
      'https://www.pbinfo.ro/solutii/user/author/problema/42/answer',
      undefined,
      [30, 10, 30, 20],
    );

    const problem = JSON.parse(
      readFileSync(join(layout.normalizedRoot, 'problems', 'problem-42.json'), 'utf8'),
    ) as { officialSourceHarvest: { qualifyingEvaluationIds: number[]; authorHandle: string } };
    expect(problem.officialSourceHarvest.qualifyingEvaluationIds).toEqual([10, 20, 30]);
    expect(problem.officialSourceHarvest.authorHandle).toBe('author');
  });
});
