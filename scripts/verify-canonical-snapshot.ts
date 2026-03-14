import { cwd } from 'node:process';

import {
  CANONICAL_SNAPSHOT_ID,
  readCanonicalSnapshotIntegrity,
} from '../src/maintenance/canonical-snapshot.js';

function main() {
  const workspaceRoot = cwd();
  const integrity = readCanonicalSnapshotIntegrity(
    workspaceRoot,
    CANONICAL_SNAPSHOT_ID,
  );
  const failures: string[] = [];

  if (integrity.crawlStatus.status !== 'completed') {
    failures.push(
      `Canonical snapshot ${integrity.snapshotId} is not marked completed (status=${integrity.crawlStatus.status}).`,
    );
  }
  if (integrity.crawlStatus.pending !== 0 || integrity.crawlStatus.inProgress !== 0) {
    failures.push(
      `Canonical snapshot queue is not drained (pending=${integrity.crawlStatus.pending}, inProgress=${integrity.crawlStatus.inProgress}).`,
    );
  }
  if (!integrity.crawlStatus.publishEligible) {
    failures.push(
      `Canonical snapshot ${integrity.snapshotId} is not publish-eligible.`,
    );
  }
  if (!integrity.filesystem.normalizedRootExists) {
    failures.push(`Missing normalized archive root: ${integrity.paths.normalizedRoot}`);
  }
  if (!integrity.filesystem.problemsRootExists) {
    failures.push(`Missing normalized problems root: ${integrity.paths.problemsRoot}`);
  }
  if (integrity.filesystem.problemRecordCount <= 0) {
    failures.push('No normalized problem records were found.');
  }
  if (!integrity.filesystem.mirrorRootExists) {
    failures.push(`Missing mirror root: ${integrity.paths.mirrorRoot}`);
  }
  if (!integrity.filesystem.mirrorRoutesPathExists) {
    failures.push(`Missing mirror route index: ${integrity.paths.mirrorRoutesPath}`);
  }

  for (const route of integrity.filesystem.sampleRoutes) {
    if (!route.mirrorFile) {
      failures.push(`Mirror route is missing from the index: ${route.route}`);
      continue;
    }
    if (!route.exists) {
      failures.push(
        `Mirror file is missing for ${route.route}: ${route.mirrorFile}`,
      );
    }
  }

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
