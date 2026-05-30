import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  prepareSnapshot,
  writeArchiveCatalog,
} from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import {
  resumeCrawlWorkflow,
  runCrawlWorkflow,
  runOfficialSourceHarvestWorkflow,
} from '../../src/workflows/crawl-workflow.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspace(localConfig?: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-crawl-workflow-branches-'));
  mkdirSync(join(root, '.local'), { recursive: true });
  if (localConfig) {
    writeFileSync(
      join(root, '.local', 'pbinfo.local.json'),
      JSON.stringify(localConfig, null, 2),
      'utf8',
    );
  }
  tempDirs.push(root);
  return root;
}

describe('runCrawlWorkflow auth preflight failures', () => {
  test('user scope without configured handle throws', async () => {
    const workspaceRoot = createWorkspace({
      crawl: {
        publicStartUrls: ['https://www.pbinfo.ro/'],
      },
    });
    await expect(runCrawlWorkflow(workspaceRoot, 'user')).rejects.toThrow(
      /requires crawl.userHandle/,
    );
  });

  test('all scope without logged-in session throws via custom probe', async () => {
    const workspaceRoot = createWorkspace({
      crawl: {
        publicStartUrls: ['https://www.pbinfo.ro/'],
        userHandle: 'Prekzursil',
      },
    });
    await expect(
      runCrawlWorkflow(workspaceRoot, 'all', {
        authStatusProbe: async () => ({
          loggedIn: false,
          status: 'cookie-missing',
          resolvedHandle: undefined,
          handleMatchesConfigured: false,
          remediation: ['Import cookies'],
        }),
      }),
    ).rejects.toThrow(/PBInfo session is not logged in/);
  });

  test('all scope with mismatched handle throws', async () => {
    const workspaceRoot = createWorkspace({
      crawl: {
        publicStartUrls: ['https://www.pbinfo.ro/'],
        userHandle: 'Prekzursil',
      },
    });
    await expect(
      runCrawlWorkflow(workspaceRoot, 'all', {
        authStatusProbe: async () => ({
          loggedIn: true,
          status: 'handle-mismatch',
          resolvedHandle: 'OtherUser',
          handleMatchesConfigured: false,
          remediation: ['Update local config'],
        }),
      }),
    ).rejects.toThrow(/does not match active session/);
  });
});

describe('resumeCrawlWorkflow no-snapshot path', () => {
  test('throws when no unfinished snapshot exists', async () => {
    const workspaceRoot = createWorkspace();
    await expect(resumeCrawlWorkflow(workspaceRoot)).rejects.toThrow(/No unfinished snapshot/);
  });
});

describe('runOfficialSourceHarvestWorkflow guard rails', () => {
  test('throws when no snapshot is available', async () => {
    const workspaceRoot = createWorkspace({
      crawl: {
        publicStartUrls: ['https://www.pbinfo.ro/'],
        userHandle: 'Prekzursil',
      },
    });
    await expect(
      runOfficialSourceHarvestWorkflow(workspaceRoot, {
        authStatusProbe: async () => ({
          loggedIn: true,
          status: 'ok',
          resolvedHandle: 'Prekzursil',
          handleMatchesConfigured: true,
          remediation: [],
        }),
      }),
    ).rejects.toThrow(/No snapshot is available/);
  });

  test('throws when snapshot exists but has no problem source-list URLs', async () => {
    const workspaceRoot = createWorkspace({
      crawl: {
        publicStartUrls: ['https://www.pbinfo.ro/'],
        userHandle: 'Prekzursil',
      },
    });
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'harvest-empty',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    writeArchiveCatalog(config.paths.archiveRoot, {
      currentSnapshotId: snapshot.snapshotId,
      canonicalSnapshotId: snapshot.snapshotId,
      snapshots: [
        {
          snapshotId: snapshot.snapshotId,
          createdAt: '2026-03-10T00:00:00.000Z',
          scope: 'all',
          status: 'completed',
          checkpoint: 'canonical',
        },
      ],
      artifactExports: [],
    });
    await expect(
      runOfficialSourceHarvestWorkflow(workspaceRoot, {
        snapshotId: snapshot.snapshotId,
        authStatusProbe: async () => ({
          loggedIn: true,
          status: 'ok',
          resolvedHandle: 'Prekzursil',
          handleMatchesConfigured: true,
          remediation: [],
        }),
      }),
    ).rejects.toThrow(/No problem source-list URLs/);
  });

  test('uses currentSnapshotId when canonicalSnapshotId is absent (lines 455-457)', async () => {
    // resolveIncrementalSnapshotId falls through to the currentSnapshotId branch (line 455-457)
    // when requestedSnapshotId is undefined AND canonicalSnapshotId is absent from the catalog.
    const workspaceRoot = createWorkspace({
      crawl: {
        publicStartUrls: ['https://www.pbinfo.ro/'],
        userHandle: 'Prekzursil',
      },
    });
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'harvest-current',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    // Write a catalog with currentSnapshotId but NO canonicalSnapshotId.
    writeArchiveCatalog(config.paths.archiveRoot, {
      currentSnapshotId: snapshot.snapshotId,
      snapshots: [
        {
          snapshotId: snapshot.snapshotId,
          createdAt: '2026-03-10T00:00:00.000Z',
          scope: 'all',
          status: 'completed',
          checkpoint: 'current',
        },
      ],
      artifactExports: [],
    });
    // No seeds will throw, but the test exercises line 455-457 (currentSnapshotId branch).
    await expect(
      runOfficialSourceHarvestWorkflow(workspaceRoot, {
        authStatusProbe: async () => ({
          loggedIn: true,
          status: 'ok',
          resolvedHandle: 'Prekzursil',
          handleMatchesConfigured: true,
          remediation: [],
        }),
      }),
    ).rejects.toThrow(/No problem source-list URLs/);
  });

  test('uses canonical snapshot when no snapshotId is given', async () => {
    const workspaceRoot = createWorkspace({
      crawl: {
        publicStartUrls: ['https://www.pbinfo.ro/'],
        userHandle: 'Prekzursil',
      },
    });
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'harvest-canon',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    writeArchiveCatalog(config.paths.archiveRoot, {
      currentSnapshotId: snapshot.snapshotId,
      canonicalSnapshotId: snapshot.snapshotId,
      snapshots: [
        {
          snapshotId: snapshot.snapshotId,
          createdAt: '2026-03-10T00:00:00.000Z',
          scope: 'all',
          status: 'completed',
          checkpoint: 'canonical',
        },
      ],
      artifactExports: [],
    });
    // No seeds will still throw, but exercises the canonical-resolution branch.
    await expect(
      runOfficialSourceHarvestWorkflow(workspaceRoot, {
        authStatusProbe: async () => ({
          loggedIn: true,
          status: 'ok',
          resolvedHandle: 'Prekzursil',
          handleMatchesConfigured: true,
          remediation: [],
        }),
      }),
    ).rejects.toThrow(/No problem source-list URLs/);
  });
});
