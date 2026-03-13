import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  exportRawArtifacts,
  markSnapshotCompleted,
  pruneToCanonicalSnapshot,
  readArchiveCatalog,
  resolveReadableSnapshotLayout,
} from '../archive/storage.js';
import { loadLocalConfig } from '../config/local-config.js';
import { readCrawlQueueSnapshot } from '../crawl/crawl-queue.js';
import { buildMirrorArtifacts } from '../mirror/build-mirror.js';
import { runRankingWorkflow } from './rank-workflow.js';
import { runNormalizeSnapshotWorkflow } from './normalize-workflow.js';

export interface CrawlStatusResult {
  snapshotId: string;
  queuePath: string;
  status: 'in_progress' | 'completed';
  pending: number;
  completed: number;
  inProgress: number;
  recentFailures: Array<{
    key: string;
    url: string;
    attemptCount: number;
    lastError: string;
    visibleAt?: string;
  }>;
  publishEligible: boolean;
}

export interface FinalizeSnapshotResult {
  snapshotId: string;
  pagesNormalized: number;
  problemsRanked: number;
  routesBuilt: number;
  artifactManifestPath: string;
}

export function getCrawlStatus(
  workspaceRoot: string,
  snapshotId?: string,
): CrawlStatusResult {
  const config = loadLocalConfig(workspaceRoot);
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  const resolvedSnapshotId = snapshotId ?? catalog.currentSnapshotId;
  if (!resolvedSnapshotId) {
    throw new Error('No archived snapshot is available.');
  }

  const queuePath = join(config.paths.localRoot, 'crawl-queues', `${resolvedSnapshotId}.sqlite`);
  const snapshotRecord = catalog.snapshots.find((entry) => entry.snapshotId === resolvedSnapshotId);
  const queueSnapshot = existsSync(queuePath)
    ? readCrawlQueueSnapshot(queuePath)
    : {
        pending: 0,
        completed: 0,
        inProgress: 0,
        items: [],
      };

  return {
    snapshotId: resolvedSnapshotId,
    queuePath,
    status: snapshotRecord?.status ?? 'in_progress',
    pending: queueSnapshot.pending,
    completed: queueSnapshot.completed,
    inProgress: queueSnapshot.inProgress,
    recentFailures: queueSnapshot.items
      .filter((item) => item.lastError)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 5)
      .map((item) => ({
        key: item.key,
        url: item.url,
        attemptCount: item.attemptCount,
        lastError: item.lastError ?? 'unknown error',
        visibleAt: item.visibleAt,
      })),
    publishEligible:
      queueSnapshot.pending === 0 &&
      queueSnapshot.inProgress === 0 &&
      snapshotRecord?.status === 'completed',
  };
}

export async function finalizeSnapshotWorkflow(
  workspaceRoot: string,
  snapshotId: string,
): Promise<FinalizeSnapshotResult> {
  const config = loadLocalConfig(workspaceRoot);
  const status = getCrawlStatus(workspaceRoot, snapshotId);
  if (status.pending > 0 || status.inProgress > 0) {
    throw new Error(
      `Snapshot ${snapshotId} is not drained yet (pending=${status.pending}, inProgress=${status.inProgress}).`,
    );
  }

  markSnapshotCompleted(config, snapshotId);
  const normalizeResult = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshotId);
  const rankingResult = await runRankingWorkflow(workspaceRoot, snapshotId);
  const mirrorResult = await buildMirrorArtifacts(workspaceRoot, snapshotId);
  const layout = resolveReadableSnapshotLayout(config, snapshotId);
  const artifactManifest = exportRawArtifacts(config, layout);
  pruneToCanonicalSnapshot(config, snapshotId);

  return {
    snapshotId,
    pagesNormalized: normalizeResult.pagesNormalized,
    problemsRanked: rankingResult.problemsRanked,
    routesBuilt: mirrorResult.routesBuilt,
    artifactManifestPath: layout.artifactManifestPath,
  };
}
