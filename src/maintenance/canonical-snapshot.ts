import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { getCrawlStatus, type CrawlStatusResult } from '../workflows/snapshot-workflow.js';

export const CANONICAL_SNAPSHOT_ID = 'acceptance-20260310b';

export const CANONICAL_SAMPLE_ROUTES = [
  '/probleme/3171/waterreserve',
  '/profil/Prekzursil',
  '/detalii-evaluare/63332367',
] as const;

export interface CanonicalSnapshotPaths {
  workspaceRoot: string;
  snapshotId: string;
  snapshotRoot: string;
  normalizedRoot: string;
  problemsRoot: string;
  mirrorRoot: string;
  mirrorRoutesPath: string;
}

export interface MirrorRouteIndexEntry {
  route: string;
  mirrorFile: string;
}

export interface CanonicalSampleRouteCheck {
  route: string;
  mirrorFile?: string;
  exists: boolean;
}

export interface CanonicalSnapshotFilesystemSummary {
  normalizedRootExists: boolean;
  problemsRootExists: boolean;
  mirrorRootExists: boolean;
  mirrorRoutesPathExists: boolean;
  problemRecordCount: number;
  sampleRoutes: CanonicalSampleRouteCheck[];
}

export interface CanonicalSnapshotIntegrity {
  snapshotId: string;
  paths: CanonicalSnapshotPaths;
  crawlStatus: CrawlStatusResult;
  filesystem: CanonicalSnapshotFilesystemSummary;
}

export function getCanonicalSnapshotPaths(
  workspaceRoot: string,
  snapshotId = CANONICAL_SNAPSHOT_ID,
): CanonicalSnapshotPaths {
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const snapshotRoot = join(
    resolvedWorkspaceRoot,
    'archive',
    'snapshots',
    snapshotId,
  );
  const normalizedRoot = join(snapshotRoot, 'normalized');
  const problemsRoot = join(normalizedRoot, 'problems');
  const mirrorRoot = join(snapshotRoot, 'mirror');
  const mirrorRoutesPath = join(mirrorRoot, 'routes.json');

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    snapshotId,
    snapshotRoot,
    normalizedRoot,
    problemsRoot,
    mirrorRoot,
    mirrorRoutesPath,
  };
}

export function readMirrorRouteIndex(mirrorRoutesPath: string): MirrorRouteIndexEntry[] {
  if (!existsSync(mirrorRoutesPath)) {
    return [];
  }

  const payload = JSON.parse(readFileSync(mirrorRoutesPath, 'utf8')) as Array<{
    route?: string;
    mirrorFile?: string;
  }>;

  return payload
    .filter(
      (entry): entry is { route: string; mirrorFile: string } =>
        typeof entry.route === 'string' && typeof entry.mirrorFile === 'string',
    )
    .map((entry) => ({
      route: entry.route,
      mirrorFile: entry.mirrorFile,
    }));
}

export function selectCanonicalSampleRoutes(
  routes: MirrorRouteIndexEntry[],
  mirrorRoot: string,
  requiredRoutes: readonly string[] = CANONICAL_SAMPLE_ROUTES,
): CanonicalSampleRouteCheck[] {
  return [...requiredRoutes].map((route) => {
    const match = routes.find((entry) => entry.route === route);
    const mirrorFile = match?.mirrorFile;

    return {
      route,
      mirrorFile,
      exists: mirrorFile ? existsSync(join(mirrorRoot, mirrorFile)) : false,
    };
  });
}

export function scanCanonicalSnapshotFilesystem(
  paths: CanonicalSnapshotPaths,
): CanonicalSnapshotFilesystemSummary {
  const normalizedRootExists = existsSync(paths.normalizedRoot);
  const problemsRootExists = existsSync(paths.problemsRoot);
  const mirrorRootExists = existsSync(paths.mirrorRoot);
  const mirrorRoutesPathExists = existsSync(paths.mirrorRoutesPath);
  const problemRecordCount = problemsRootExists
    ? readdirSync(paths.problemsRoot, {
        withFileTypes: true,
      }).filter(
        (entry) => entry.isFile() && /^problem-\d+\.json$/i.test(entry.name),
      ).length
    : 0;

  const mirrorRoutes = readMirrorRouteIndex(paths.mirrorRoutesPath);
  const sampleRoutes = selectCanonicalSampleRoutes(mirrorRoutes, paths.mirrorRoot);

  return {
    normalizedRootExists,
    problemsRootExists,
    mirrorRootExists,
    mirrorRoutesPathExists,
    problemRecordCount,
    sampleRoutes,
  };
}

export function readCanonicalSnapshotIntegrity(
  workspaceRoot: string,
  snapshotId = CANONICAL_SNAPSHOT_ID,
): CanonicalSnapshotIntegrity {
  const paths = getCanonicalSnapshotPaths(workspaceRoot, snapshotId);

  return {
    snapshotId,
    paths,
    crawlStatus: getCrawlStatus(workspaceRoot, snapshotId),
    filesystem: scanCanonicalSnapshotFilesystem(paths),
  };
}
