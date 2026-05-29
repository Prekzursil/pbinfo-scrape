import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { createDesktopController } from '../../src/gui/main/desktop-controller.js';
import { readGuiJob, createGuiJob, updateGuiJob } from '../../src/gui/main/job-store.js';
import type { DesktopNotification } from '../../src/gui/main/notification-service.js';
import { initializeWorkspaceState } from '../../src/gui/main/workspace-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-extra-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.local'), { recursive: true });
  initializeWorkspaceState(root, {
    now: new Date('2026-03-10T12:00:00.000Z'),
  });
  return root;
}

describe('desktop controller - simple job kinds', () => {
  test('runNormalize startJob completes via injected workflow', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const runNormalizeSnapshotWorkflow = vi.fn(async () => ({
      pagesNormalized: 5,
      snapshotId: 'snap-norm',
    }));
    const controller = createDesktopController(workspaceRoot, {
      runNormalizeSnapshotWorkflow,
    });

    const result = await controller.startJob({
      kind: 'normalize',
      snapshotId: 'snap-norm',
      now: new Date('2026-03-10T12:01:00.000Z'),
    });

    expect(result.status).toBe('completed');
    expect(result.detail).toEqual(
      expect.objectContaining({
        pagesNormalized: 5,
        snapshotId: 'snap-norm',
      }),
    );
    expect(runNormalizeSnapshotWorkflow).toHaveBeenCalledWith(workspaceRoot, 'snap-norm');
  });

  test('runRanking startJob completes via injected workflow', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const runRankingWorkflow = vi.fn(async () => ({
      problemsRanked: 12,
      outputPath: join(workspaceRoot, 'out.json'),
    }));
    const controller = createDesktopController(workspaceRoot, {
      runRankingWorkflow,
    });

    const result = await controller.startJob({
      kind: 'rank',
      snapshotId: 'snap-rank',
      now: new Date('2026-03-10T12:01:00.000Z'),
    });

    expect(result.status).toBe('completed');
    expect(result.detail).toEqual(
      expect.objectContaining({
        problemsRanked: 12,
      }),
    );
  });

  test('runMirrorBuild startJob completes via injected workflow', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const buildMirrorArtifacts = vi.fn(async () => ({
      routesBuilt: 3,
      snapshotId: 'snap-mirror',
      outputRoot: join(workspaceRoot, 'mirror'),
    }));
    const controller = createDesktopController(workspaceRoot, {
      buildMirrorArtifacts,
    });

    const result = await controller.startJob({
      kind: 'mirror-build',
      snapshotId: 'snap-mirror',
      now: new Date('2026-03-10T12:01:00.000Z'),
    });

    expect(result.status).toBe('completed');
    expect(result.detail).toEqual(
      expect.objectContaining({
        routesBuilt: 3,
        snapshotId: 'snap-mirror',
      }),
    );
  });

  test('finalize startJob rejects when snapshotId is missing', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot);

    await expect(
      controller.startJob({
        kind: 'snapshot-finalize',
      }),
    ).rejects.toThrow(/snapshot-finalize jobs require a snapshotId/);
  });

  test('getJob returns persisted records by id', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot, {
      runRankingWorkflow: async () => ({
        problemsRanked: 1,
        outputPath: 'x',
      }),
    });
    const created = await controller.startJob({
      kind: 'rank',
      snapshotId: 'snap',
    });
    const fetched = controller.getJob(created.jobId);
    expect(fetched.jobId).toBe(created.jobId);
    expect(fetched.status).toBe('completed');
  });
});

describe('desktop controller - mirror preview failure branches', () => {
  test('startMirrorPreview captures non-Error throws with String fallback', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const notifications: DesktopNotification[] = [];
    const controller = createDesktopController(workspaceRoot, {
      startMirrorServer: async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- branch coverage
        throw 'mirror-string-fail';
      },
      notificationService: {
        notify: async (message) => {
          notifications.push(message);
        },
      },
    });
    await expect(controller.startMirrorPreview('snap-x', { port: 0 })).rejects.toBe(
      'mirror-string-fail',
    );
    expect(notifications).toEqual([
      expect.objectContaining({
        level: 'error',
        title: 'Mirror preview failed',
      }),
    ]);
  });
});

describe('desktop controller - resolveCrawlDetail fallbacks', () => {
  test('startJob without detail falls back to scope=all', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const runCrawlWorkflow = vi.fn(async () => ({
      processed: 0,
      queuePath: join(workspaceRoot, '.local', 'q.sqlite'),
      snapshotId: 'snap-fallback',
      completed: true,
    }));
    const controller = createDesktopController(workspaceRoot, {
      runCrawlWorkflow,
      getCrawlStatusWorkflow: () => ({
        snapshotId: 'snap-fallback',
        queuePath: join(workspaceRoot, '.local', 'q.sqlite'),
        pending: 0,
        completed: 0,
        inProgress: 0,
        publishEligible: true,
        recentFailures: [],
      }),
    });
    await controller.startJob({
      kind: 'crawl',
      snapshotId: 'snap-fallback',
      now: new Date('2026-03-10T12:01:00.000Z'),
    });
    expect(runCrawlWorkflow).toHaveBeenCalledWith(
      workspaceRoot,
      'all',
      expect.objectContaining({
        snapshotId: 'snap-fallback',
      }),
    );
  });
});

describe('desktop controller - resume guard rails', () => {
  test('resumeJob refuses non-crawl jobs', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot, {
      runNormalizeSnapshotWorkflow: async () => ({
        pagesNormalized: 0,
        snapshotId: 'sn',
      }),
    });
    const job = await controller.startJob({
      kind: 'normalize',
      snapshotId: 'sn',
    });
    await expect(controller.resumeJob(job.jobId)).rejects.toThrow(/not resumable/);
  });
});

describe('desktop controller - auth failure paths', () => {
  test('loginProfile uses generic error when auth result omits failureReason', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const notifications: DesktopNotification[] = [];
    const controller = createDesktopController(workspaceRoot, {
      createAuthClient: () =>
        ({
          loginWithCredentials: async () => ({
            success: false,
          }),
        }) as never,
      notificationService: {
        notify: async (message) => {
          notifications.push(message);
        },
      },
    });

    await expect(
      controller.loginProfile({
        profileId: 'alpha',
        label: 'Primary',
        username: 'a',
        password: 'b',
      }),
    ).rejects.toThrow(/PBInfo credential login did not produce an authenticated session/);
  });

  test('loginProfile failAuthJob branch records non-Error throwables as String message', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const notifications: DesktopNotification[] = [];
    const controller = createDesktopController(workspaceRoot, {
      createAuthClient: () =>
        ({
          loginWithCredentials: async () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- intentionally throw a non-Error for branch coverage
            throw 'string-error';
          },
        }) as never,
      notificationService: {
        notify: async (message) => {
          notifications.push(message);
        },
      },
    });

    await expect(
      controller.loginProfile({
        profileId: 'alpha',
        label: 'Primary',
        username: 'a',
        password: 'b',
      }),
    ).rejects.toBe('string-error');
    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'PBInfo login failed',
        message: expect.stringContaining('string-error'),
      }),
    ]);
  });

  test('importBrowserProfile uses Default when profileName omitted', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot, {
      importBrowserCookies: async () => [
        {
          name: 'PHPSESSID',
          value: 'browser-cookie',
          domain: 'www.pbinfo.ro',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
        },
      ],
    });
    const result = await controller.importBrowserProfile({
      profileId: 'edge2',
      label: 'Edge',
      browser: 'edge',
      // profileName omitted on purpose
    });
    expect(result.job.status).toBe('completed');
  });

  test('loginProfile fails the job and notifies when auth returns failure', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const notifications: DesktopNotification[] = [];
    const controller = createDesktopController(workspaceRoot, {
      createAuthClient: () =>
        ({
          loginWithCredentials: async () => ({
            success: false,
            failureReason: 'invalid creds',
          }),
        }) as never,
      notificationService: {
        notify: async (message) => {
          notifications.push(message);
        },
      },
    });

    await expect(
      controller.loginProfile({
        profileId: 'alpha',
        label: 'Primary',
        username: 'a',
        password: 'b',
        now: new Date('2026-03-10T12:00:00.000Z'),
      }),
    ).rejects.toThrow(/invalid creds/);

    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'PBInfo login failed',
        level: 'error',
      }),
    ]);
  });

  test('importBrowserProfile fails the job and notifies on import error', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const notifications: DesktopNotification[] = [];
    const controller = createDesktopController(workspaceRoot, {
      importBrowserCookies: async () => {
        throw new Error('decrypt failed');
      },
      notificationService: {
        notify: async (message) => {
          notifications.push(message);
        },
      },
    });

    await expect(
      controller.importBrowserProfile({
        profileId: 'edge',
        label: 'Edge',
        browser: 'edge',
        now: new Date('2026-03-10T12:00:00.000Z'),
      }),
    ).rejects.toThrow(/decrypt failed/);

    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'Browser import failed',
        level: 'error',
      }),
    ]);
  });

  test('default createAuthClient is wired and instantiated by createDesktopController', () => {
    const workspaceRoot = createWorkspaceRoot();
    // Just exercising the default factory closure runs without errors.
    const controller = createDesktopController(workspaceRoot);
    expect(controller).toBeDefined();
  });
});

describe('desktop controller - recover and crawl-status branches', () => {
  test('recoverInterruptedJobs marks running jobs as paused', async () => {
    const workspaceRoot = createWorkspaceRoot();
    // Seed a running job that should be recovered.
    const seeded = createGuiJob(workspaceRoot, {
      jobId: 'recover-1',
      kind: 'crawl',
      snapshotId: 'snap-r',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });
    updateGuiJob(workspaceRoot, seeded.jobId, {
      status: 'running',
    });

    const controller = createDesktopController(workspaceRoot);
    const recovered = controller.recoverInterruptedJobs({
      now: new Date('2026-03-10T12:05:00.000Z'),
    });
    expect(recovered.length).toBeGreaterThan(0);
    expect(readGuiJob(workspaceRoot, 'recover-1').status).not.toBe('running');
  });

  test('getCrawlStatus returns null when the snapshot is missing from catalog', () => {
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot, {
      getCrawlStatusWorkflow: () => {
        throw new Error('Snapshot ghost was not found in archive/catalog.json');
      },
    });
    expect(controller.getCrawlStatus('ghost')).toBeNull();
  });

  test('getCrawlStatus re-throws unrelated errors', () => {
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot, {
      getCrawlStatusWorkflow: () => {
        throw new Error('boom');
      },
    });
    expect(() => controller.getCrawlStatus('snap')).toThrow(/boom/);
  });
});

describe('desktop controller - coverage rebuild path', () => {
  test('getCoverageSummary rebuilds coverage when reader complains it has not been generated', async () => {
    const workspaceRoot = createWorkspaceRoot();
    let attempts = 0;
    const runProblemCoverageWorkflow = vi.fn(async () => undefined as never);
    const controller = createDesktopController(workspaceRoot, {
      getCoverageExplorerSummary: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Problem coverage has not been generated for snapshot.');
        }
        return {
          snapshotId: 'snap-cov',
          generatedAt: '2026-03-10T12:00:00.000Z',
          totals: {
            problems: 0,
            covered: 0,
            partial: 0,
            uncovered: 0,
          },
          datasets: [],
        } as never;
      },
      runProblemCoverageWorkflow,
    });

    const summary = await controller.getCoverageSummary('snap-cov');
    expect(summary).toEqual(
      expect.objectContaining({
        snapshotId: 'snap-cov',
      }),
    );
    expect(runProblemCoverageWorkflow).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(2);
  });

  test('getCoverageSummary rethrows unrelated reader errors', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot, {
      getCoverageExplorerSummary: () => {
        throw new Error('unrelated read error');
      },
    });
    await expect(controller.getCoverageSummary('snap')).rejects.toThrow(/unrelated read error/);
  });

  test('getCoverageSummary rebuild uses __current__ key when snapshotId is omitted', async () => {
    const workspaceRoot = createWorkspaceRoot();
    let attempts = 0;
    const runProblemCoverageWorkflow = vi.fn(async () => undefined as never);
    const controller = createDesktopController(workspaceRoot, {
      getCoverageExplorerSummary: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Problem coverage has not been generated yet.');
        }
        return {
          snapshotId: '__current__',
          generatedAt: '2026-03-10T12:00:00.000Z',
          totals: {
            problems: 0,
            covered: 0,
            partial: 0,
            uncovered: 0,
          },
          datasets: [],
        } as never;
      },
      runProblemCoverageWorkflow,
    });

    await controller.getCoverageSummary(undefined);
    expect(runProblemCoverageWorkflow).toHaveBeenCalledWith(workspaceRoot, undefined);
  });

  test('listCoverageRecords concurrently triggers only one rebuild', async () => {
    const workspaceRoot = createWorkspaceRoot();
    let attempts = 0;
    let resolveWorkflow: () => void = () => undefined;
    const workflowPromise = new Promise<void>((resolve) => {
      resolveWorkflow = resolve;
    });
    const runProblemCoverageWorkflow = vi.fn(async () => {
      await workflowPromise;
      return undefined as never;
    });
    const controller = createDesktopController(workspaceRoot, {
      listCoverageExplorerRecords: () => {
        attempts += 1;
        if (attempts <= 2) {
          throw new Error('Problem coverage has not been generated.');
        }
        return {
          snapshotId: 'snap',
          items: [],
          total: 0,
        } as never;
      },
      runProblemCoverageWorkflow,
    });

    const a = controller.listCoverageRecords({
      snapshotId: 'snap',
      dataset: 'problems',
    } as never);
    const b = controller.listCoverageRecords({
      snapshotId: 'snap',
      dataset: 'problems',
    } as never);
    // Resolve the pending workflow so both retries can proceed.
    resolveWorkflow();
    await Promise.all([a, b]);
    expect(runProblemCoverageWorkflow).toHaveBeenCalledTimes(1);
  });
});
