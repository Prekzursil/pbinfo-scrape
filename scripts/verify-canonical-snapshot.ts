import { cwd } from 'node:process';

import {
  CANONICAL_SNAPSHOT_ID,
  readCanonicalSnapshotIntegrity,
} from '../src/maintenance/canonical-snapshot.js';

type SnapshotIntegrity = ReturnType<typeof readCanonicalSnapshotIntegrity>;

function collectIntegrityFailures(integrity: SnapshotIntegrity): string[] {
  const failures: string[] = [];
  const checks: Array<{ failed: boolean; message: string }> = [
    {
      failed: integrity.crawlStatus.status !== 'completed',
      message: `Canonical snapshot ${integrity.snapshotId} is not marked completed (status=${integrity.crawlStatus.status}).`,
    },
    {
      failed: integrity.crawlStatus.pending !== 0 || integrity.crawlStatus.inProgress !== 0,
      message: `Canonical snapshot queue is not drained (pending=${integrity.crawlStatus.pending}, inProgress=${integrity.crawlStatus.inProgress}).`,
    },
    {
      failed: !integrity.crawlStatus.publishEligible,
      message: `Canonical snapshot ${integrity.snapshotId} is not publish-eligible.`,
    },
    {
      failed: !integrity.filesystem.normalizedRootExists,
      message: `Missing normalized archive root: ${integrity.paths.normalizedRoot}`,
    },
    {
      failed: !integrity.filesystem.problemsRootExists,
      message: `Missing normalized problems root: ${integrity.paths.problemsRoot}`,
    },
    {
      failed: integrity.filesystem.problemRecordCount <= 0,
      message: 'No normalized problem records were found.',
    },
    {
      failed: !integrity.filesystem.mirrorRootExists,
      message: `Missing mirror root: ${integrity.paths.mirrorRoot}`,
    },
    {
      failed: !integrity.filesystem.mirrorRoutesPathExists,
      message: `Missing mirror route index: ${integrity.paths.mirrorRoutesPath}`,
    },
  ];
  for (const check of checks) {
    if (check.failed) {
      failures.push(check.message);
    }
  }

  failures.push(...collectRouteFailures(integrity));
  return failures;
}

function collectRouteFailures(integrity: SnapshotIntegrity): string[] {
  const failures: string[] = [];
  for (const route of integrity.filesystem.sampleRoutes) {
    if (!route.mirrorFile) {
      failures.push(`Mirror route is missing from the index: ${route.route}`);
    } else if (!route.exists) {
      failures.push(`Mirror file is missing for ${route.route}: ${route.mirrorFile}`);
    }
  }
  return failures;
}

function main() {
  const workspaceRoot = cwd();
  const integrity = readCanonicalSnapshotIntegrity(workspaceRoot, CANONICAL_SNAPSHOT_ID);
  const failures = collectIntegrityFailures(integrity);

  const report = {
    snapshotId: integrity.snapshotId,
    crawlStatus: integrity.crawlStatus,
    paths: integrity.paths,
    filesystem: integrity.filesystem,
    checksPassed: failures.length === 0,
    failures,
  };

  console.log(JSON.stringify(report, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
