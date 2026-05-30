import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

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
    await resetNormalizedDirectory(join(snapshot.normalizedRoot, directory));
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
    const normalizedKind = normalizeSnapshotPageKind(pageRecord);
    persistNormalizedSnapshotHtml({
      config,
      snapshot,
      item: {
        key: `${normalizedKind}:${pageRecord.url}`,
        url: pageRecord.url,
        kind: normalizedKind,
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

async function resetNormalizedDirectory(directoryPath: string): Promise<void> {
  mkdirSync(directoryPath, { recursive: true });
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await clearDirectoryContents(directoryPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableDirectoryResetError(error) || attempt === 2) {
        throw error;
      }
      /* v8 ignore next 2 -- async retry-delay; backoff delay only exercised after repeated failures */
      await delay(250 * (attempt + 1));
    }
  }

  /* v8 ignore next 2 -- async retry-delay; post-retry throw unreachable without exhausting all attempts */
  throw lastError;
}

async function clearDirectoryContents(directoryPath: string): Promise<void> {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    await removePathRobustly(join(directoryPath, entry.name));
  }
}

async function removePathRobustly(targetPath: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      rmSync(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableDirectoryResetError(error) || attempt === 59) {
        throw error;
      }

      /* v8 ignore next 2 -- async retry-delay; backoff delay only exercised after repeated failures */
      await delay(Math.min(1000, 50 * (attempt + 1)));
    }
  }

  /* v8 ignore next 2 -- async retry-delay; post-retry throw unreachable without exhausting all attempts */
  throw lastError;
}

function isRetryableDirectoryResetError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return ['ENOTEMPTY', 'EBUSY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '');
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

function normalizeSnapshotPageKind(pageRecord: PageRecord): CrawlQueueInput['kind'] {
  return pageRecord.kind as CrawlQueueInput['kind'];
}
