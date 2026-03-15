import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { resolveReadableSnapshotLayout } from '../archive/storage.js';
import { loadLocalConfig } from '../config/local-config.js';
import { persistNormalizedSnapshotHtml } from '../crawl/archive-crawler.js';
import type { CrawlQueueInput } from '../types/crawl.js';
import type { PageRecord } from '../types/records.js';

export interface NormalizeSnapshotResult {
  snapshotId: string;
  pagesNormalized: number;
  normalizedRoot: string;
}

const REBUILT_DIRECTORIES = [
  'categories',
  'evaluation-errors',
  'evaluations',
  'problems',
  'routes',
  'sources',
  'tests',
  'user-solutions',
];

export async function runNormalizeSnapshotWorkflow(
  workspaceRoot: string,
  snapshotId?: string,
): Promise<NormalizeSnapshotResult> {
  const config = loadLocalConfig(workspaceRoot);
  const snapshot = resolveReadableSnapshotLayout(config, snapshotId);

  for (const directory of REBUILT_DIRECTORIES) {
    rmSync(join(snapshot.normalizedRoot, directory), { recursive: true, force: true });
    mkdirSync(join(snapshot.normalizedRoot, directory), { recursive: true });
  }

  const pageRecords = loadPageRecords(join(snapshot.normalizedRoot, 'pages'));
  let pagesNormalized = 0;

  for (const pageRecord of pageRecords) {
    if (!pageRecord.bodyPath?.startsWith('raw-pages/')) {
      continue;
    }

    const htmlPath = join(snapshot.rawPagesRoot, pageRecord.bodyPath.replace(/^raw-pages\//, ''));
    if (!existsSync(htmlPath)) {
      continue;
    }

    const html = readFileSync(htmlPath, 'utf8');
    persistNormalizedSnapshotHtml({
      config,
      snapshot,
      item: {
        key: `${pageRecord.kind}:${pageRecord.url}`,
        url: pageRecord.url,
        kind: pageRecord.kind as CrawlQueueInput['kind'],
      },
      html,
      httpStatus: pageRecord.httpStatus,
      contentType: pageRecord.contentType,
      fetchedAt: pageRecord.fetchedAt,
    });
    pagesNormalized += 1;
  }

  return {
    snapshotId: snapshot.snapshotId,
    pagesNormalized,
    normalizedRoot: snapshot.normalizedRoot,
  };
}

function loadPageRecords(root: string): PageRecord[] {
  try {
    return readdirSync(root)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => JSON.parse(readFileSync(join(root, entry), 'utf8')) as PageRecord);
  } catch {
    return [];
  }
}
