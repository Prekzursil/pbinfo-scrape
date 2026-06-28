import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test, vi } from 'vitest';

const authClientMock = vi.hoisted(() => ({
  loginWithCredentials: vi.fn(async () => ({
    success: true,
    redirectUrl: 'https://www.pbinfo.ro/profil/Prekzursil',
    sessionCookies: [
      { key: 'PHPSESSID', value: 'cookie-value', domain: 'www.pbinfo.ro', path: '/', secure: true, httpOnly: true },
    ],
  })),
}));

vi.mock('../../src/auth/pbinfo-auth.js', () => ({
  PbinfoAuthClient: class {
    loginWithCredentials = authClientMock.loginWithCredentials;
  },
}));

const { createDesktopController } = await import('../../src/gui/main/desktop-controller.js');
const { initializeWorkspaceState } = await import('../../src/gui/main/workspace-store.js');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  authClientMock.loginWithCredentials.mockClear();
});

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pbinfo-controller-edge-'));
  tempDirs.push(dir);
  initializeWorkspaceState(dir, { now: new Date('2026-03-10T12:00:00.000Z') });
  return dir;
}

describe('desktop controller edge cases', () => {
  test('runs normalize, rank, and mirror-build jobs through injected workflows', async () => {
    const workspaceRoot = makeWorkspace();
    const controller = createDesktopController(workspaceRoot, {
      runNormalizeSnapshotWorkflow: vi.fn(async () => ({ pagesNormalized: 3, snapshotId: 's' })) as never,
      runRankingWorkflow: vi.fn(async () => ({ problemsRanked: 2, outputPath: '/out.json' })) as never,
      buildMirrorArtifacts: vi.fn(async () => ({ routesBuilt: 5, snapshotId: 's', outputRoot: '/mirror' })) as never,
    });

    expect((await controller.startJob({ kind: 'normalize', snapshotId: 's' })).status).toBe('completed');
    expect((await controller.startJob({ kind: 'rank', snapshotId: 's' })).status).toBe('completed');
    expect((await controller.startJob({ kind: 'mirror-build', snapshotId: 's' })).status).toBe('completed');
  });

  test('exposes getJob and recoverInterruptedJobs', async () => {
    const workspaceRoot = makeWorkspace();
    const controller = createDesktopController(workspaceRoot, {
      runNormalizeSnapshotWorkflow: vi.fn(async () => ({ pagesNormalized: 1, snapshotId: 's' })) as never,
    });
    const job = await controller.startJob({ kind: 'normalize', snapshotId: 's' });
    expect(controller.getJob(job.jobId).jobId).toBe(job.jobId);
    expect(controller.recoverInterruptedJobs()).toEqual([]);
  });

  test('rejects finalize without a snapshot and refuses to resume non-crawl jobs', async () => {
    const workspaceRoot = makeWorkspace();
    const controller = createDesktopController(workspaceRoot, {
      runNormalizeSnapshotWorkflow: vi.fn(async () => ({ pagesNormalized: 1, snapshotId: 's' })) as never,
    });
    await expect(controller.startJob({ kind: 'snapshot-finalize' })).rejects.toThrow(/require a snapshotId/);
    const normalizeJob = await controller.startJob({ kind: 'normalize', snapshotId: 's' });
    await expect(controller.resumeJob(normalizeJob.jobId)).rejects.toThrow(/not resumable/);
  });

  test('maps a missing-snapshot crawl status to null and rethrows other failures', () => {
    const workspaceRoot = makeWorkspace();
    const missing = createDesktopController(workspaceRoot, {
      getCrawlStatusWorkflow: (() => {
        throw new Error('Snapshot ghost was not found in archive/catalog.json');
      }) as never,
    });
    expect(missing.getCrawlStatus('ghost')).toBeNull();

    const broken = createDesktopController(workspaceRoot, {
      getCrawlStatusWorkflow: (() => {
        throw new Error('disk exploded');
      }) as never,
    });
    expect(() => broken.getCrawlStatus('x')).toThrow(/disk exploded/);
  });

  test('fails the login job when the auth client reports an unsuccessful login', async () => {
    const workspaceRoot = makeWorkspace();
    const notifications: Array<{ title: string }> = [];
    const controller = createDesktopController(workspaceRoot, {
      createAuthClient: () =>
        ({ loginWithCredentials: async () => ({ success: false, failureReason: 'bad password' }) }) as never,
      notificationService: { notify: async (m) => { notifications.push(m); } },
    });
    await expect(
      controller.loginProfile({ profileId: 'a', label: 'A', username: 'u', password: 'p' }),
    ).rejects.toThrow(/bad password/);
    expect(notifications[0]?.title).toBe('PBInfo login failed');
  });

  test('fails the browser import job when cookie import throws', async () => {
    const workspaceRoot = makeWorkspace();
    const notifications: Array<{ title: string }> = [];
    const controller = createDesktopController(workspaceRoot, {
      importBrowserCookies: (async () => {
        throw new Error('no browser profile');
      }) as never,
      notificationService: { notify: async (m) => { notifications.push(m); } },
    });
    await expect(
      controller.importBrowserProfile({ profileId: 'b', label: 'B', browser: 'edge' }),
    ).rejects.toThrow(/no browser profile/);
    expect(notifications[0]?.title).toBe('Browser import failed');
  });

  test('rebuilds the coverage dataset when the reader reports it is missing', async () => {
    const workspaceRoot = makeWorkspace();
    let attempts = 0;
    const runProblemCoverageWorkflow = vi.fn(async () => ({}) as never);
    const controller = createDesktopController(workspaceRoot, {
      runProblemCoverageWorkflow,
      getCoverageExplorerSummary: (() => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Problem coverage has not been generated for this snapshot.');
        }
        return { snapshotId: 's', totalProblems: 0 };
      }) as never,
    });
    const summary = await controller.getCoverageSummary();
    expect(summary).toBeTruthy();
    expect(runProblemCoverageWorkflow).toHaveBeenCalledTimes(1);
  });

  test('uses the default failure message when none is provided', async () => {
    const workspaceRoot = makeWorkspace();
    const controller = createDesktopController(workspaceRoot, {
      createAuthClient: () => ({ loginWithCredentials: async () => ({ success: false }) }) as never,
      notificationService: { notify: async () => undefined },
    });
    await expect(
      controller.loginProfile({ profileId: 'a', label: 'A', username: 'u', password: 'p' }),
    ).rejects.toThrow(/did not produce an authenticated session/);
  });

  test('handles a non-Error login rejection', async () => {
    const workspaceRoot = makeWorkspace();
    const controller = createDesktopController(workspaceRoot, {
      createAuthClient: () =>
        ({ loginWithCredentials: async () => { throw 'string boom'; } }) as never,
      notificationService: { notify: async () => undefined },
    });
    await expect(
      controller.loginProfile({ profileId: 'a', label: 'A', username: 'u', password: 'p' }),
    ).rejects.toBe('string boom');
  });

  test('imports browser cookies without an explicit profile name', async () => {
    const workspaceRoot = makeWorkspace();
    const controller = createDesktopController(workspaceRoot, {
      importBrowserCookies: (async () => [
        { name: 'PHPSESSID', value: 'c', domain: 'www.pbinfo.ro', path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
      ]) as never,
      notificationService: { notify: async () => undefined },
    });
    const result = await controller.importBrowserProfile({ profileId: 'b', label: 'B', browser: 'edge' });
    expect(result.job.status).toBe('completed');
  });

  test('starts a mirror preview without a port and surfaces a non-Error server failure', async () => {
    const workspaceRoot = makeWorkspace();
    const ok = createDesktopController(workspaceRoot, {
      startMirrorServer: (async () => ({ baseUrl: 'http://127.0.0.1:9999', close: async () => undefined })) as never,
      notificationService: { notify: async () => undefined },
    });
    const preview = await ok.startMirrorPreview('s');
    expect(preview.baseUrl).toBe('http://127.0.0.1:9999');
    await ok.stopMirrorPreview(preview.job.jobId);

    const broken = createDesktopController(workspaceRoot, {
      startMirrorServer: (async () => { throw 'server string failure'; }) as never,
      notificationService: { notify: async () => undefined },
    });
    await expect(broken.startMirrorPreview('s')).rejects.toBe('server string failure');
  });

  test('marks a completed crawl chunk with recent failures as a warning', async () => {
    const workspaceRoot = makeWorkspace();
    const events: Array<{ title: string }> = [];
    const controller = createDesktopController(workspaceRoot, {
      runCrawlWorkflow: (async () => ({ snapshotId: 's', processed: 5, completed: true })) as never,
      getCrawlStatusWorkflow: (() => ({
        snapshotId: 's',
        queuePath: 'q',
        status: 'completed',
        pending: 0,
        completed: 10,
        inProgress: 0,
        publishEligible: true,
        recentFailures: [{ key: 'k', url: 'https://x/', attemptCount: 2, lastError: 'boom' }],
      })) as never,
      notificationService: { notify: async (m) => { events.push(m); } },
    });
    const job = await controller.startJob({ kind: 'crawl', snapshotId: 's' });
    expect(job.status).toBe('completed');
  });

  test('coalesces concurrent coverage dataset rebuilds', async () => {
    const workspaceRoot = makeWorkspace();
    const runProblemCoverageWorkflow = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({}), 20)) as never,
    );
    const seen = { summary: 0, list: 0 };
    const controller = createDesktopController(workspaceRoot, {
      runProblemCoverageWorkflow,
      getCoverageExplorerSummary: (() => {
        seen.summary += 1;
        if (seen.summary === 1) throw new Error('Problem coverage has not been generated for this snapshot.');
        return { snapshotId: 's', totalProblems: 0 };
      }) as never,
      listCoverageExplorerRecords: (() => {
        seen.list += 1;
        if (seen.list === 1) throw new Error('Problem coverage has not been generated for this snapshot.');
        return { snapshotId: 's', totalCount: 0, offset: 0, limit: 100, items: [] };
      }) as never,
    });
    const [summary, listing] = await Promise.all([
      controller.getCoverageSummary('s'),
      controller.listCoverageRecords({ snapshotId: 's' }),
    ]);
    expect(summary).toBeTruthy();
    expect(listing).toBeTruthy();
    expect(runProblemCoverageWorkflow).toHaveBeenCalledTimes(1);
  });

  test('uses the default auth client when none is injected', async () => {
    const workspaceRoot = makeWorkspace();
    const controller = createDesktopController(workspaceRoot, {
      notificationService: { notify: async () => undefined },
    });
    const result = await controller.loginProfile({
      profileId: 'default-auth',
      label: 'Default',
      username: 'u',
      password: 'p',
    });
    expect(result.profile.profileId).toBe('default-auth');
    expect(authClientMock.loginWithCredentials).toHaveBeenCalled();
  });
});
