import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/gui/renderer/app.js';
import type { DesktopBridge } from '../../src/gui/shared/bridge.js';
import type { GuiJobRecord, GuiWorkspaceState } from '../../src/gui/shared/types.js';

afterEach(() => {
  cleanup();
});

function workspace(): GuiWorkspaceState {
  return {
    version: 1,
    workspaceRoot: 'C:/ws',
    activeProfileId: 'alpha',
    profiles: [
      {
        profileId: 'alpha',
        label: 'Primary',
        userHandle: 'Prekzursil',
        provenance: { type: 'login' },
        sessionCookiesPath: '.local/x.json',
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ],
    notifications: { desktopBanners: true, windowsToast: true },
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z',
  };
}

function makeJob(overrides: Partial<GuiJobRecord> = {}): GuiJobRecord {
  return {
    jobId: 'job-1',
    kind: 'crawl',
    status: 'completed',
    snapshotId: 'snap-1',
    logPath: '.local/x.jsonl',
    resumable: false,
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:01:00.000Z',
    ...overrides,
  } as GuiJobRecord;
}

function makeBridge(jobs: GuiJobRecord[] = [], verbosity = 'normal' as 'normal' | 'verbose' | 'raw'): DesktopBridge {
  return {
    getDesktopPreferences: vi.fn(async () => ({
      verbosityMode: verbosity,
      workspaceRoot: 'C:/ws',
    })),
    setVerbosityMode: vi.fn(async (mode) => ({ verbosityMode: mode, workspaceRoot: 'C:/ws' })),
    getWorkspaceState: vi.fn(async () => workspace()),
    selectWorkspace: vi.fn(async () => workspace()),
    loginProfile: vi.fn(async () => ({
      profile: workspace().profiles[0],
      workspaceState: workspace(),
      job: makeJob({ kind: 'auth-login', status: 'completed' }),
    })),
    importBrowserProfile: vi.fn(async () => ({
      profile: workspace().profiles[0],
      workspaceState: workspace(),
      job: makeJob({ kind: 'auth-import-browser', status: 'completed' }),
    })),
    createProfile: vi.fn(async () => workspace().profiles[0]),
    activateProfile: vi.fn(async () => workspace()),
    deleteProfile: vi.fn(async () => workspace()),
    getArchiveExplorerSummary: vi.fn(async () => ({
      snapshotId: 'snap-1',
      normalizedRoot: 'C:/ws/normalized',
      mirrorRoot: 'C:/ws/mirror',
      mirrorServeCommand: 'cmd',
      mirrorUrl: 'http://127.0.0.1/',
      datasets: [],
    })),
    listArchiveExplorerRecords: vi.fn(async () => ({
      snapshotId: 'snap-1',
      dataset: 'problems' as const,
      totalCount: 0,
      offset: 0,
      limit: 24,
      items: [],
    })),
    getArchiveExplorerRecord: vi.fn(async () => undefined as never),
    getCoverageSummary: vi.fn(async () => ({
      snapshotId: 'snap-1',
      coverageRoot: 'C:/ws/cov',
      normalizedRoot: 'C:/ws/normalized',
      mirrorRoot: 'C:/ws/mirror',
      mirrorServeCommand: 'cmd',
      mirrorUrl: 'http://127.0.0.1/',
      totalProblems: 0,
      solvedByMeCount: 0,
      completeProblemCount: 0,
      incompleteSolvedProblemCount: 0,
      missingOfficialSourceCaptureCount: 0,
      officialSourceUnavailableUpstreamCount: 0,
      missingTestsCaptureCount: 0,
      testsUnavailableUpstreamCount: 0,
      statementArchivedCount: 0,
      solutionFragmentArchivedCount: 0,
      testsFragmentArchivedCount: 0,
      problemsWithExamples: 0,
      problemsWithVisibleTestsCaptured: 0,
      problemsWithEvaluationObservedTests: 0,
      problemsWithEffectiveTests: 0,
      problemsWithArchivedSources: 0,
      problemsWithOfficialSourceArchived: 0,
      problemsWithUserSourceArchived: 0,
      editorialVisibleCount: 0,
      rankingPresentCount: 0,
      newSinceBaselineCount: 0,
      unsolvedProblemCount: 0,
      missingOfficialSourceCount: 0,
      solvedByMeMissingUserSourceCount: 0,
    })),
    listCoverageRecords: vi.fn(async () => ({ snapshotId: 'snap-1', totalCount: 0, offset: 0, limit: 100, items: [] })),
    getCoverageRecord: vi.fn(async () => undefined as never),
    getCrawlStatus: vi.fn(async () => ({
      snapshotId: 'snap-1',
      queuePath: '.local/q.sqlite',
      status: 'completed' as const,
      pending: 0,
      completed: 1,
      inProgress: 0,
      publishEligible: false,
      recentFailures: [],
    })),
    listJobs: vi.fn(async () => jobs),
    listJobEvents: vi.fn(async () => []),
    startJob: vi.fn(async (input) =>
      makeJob({ kind: input.kind, snapshotId: input.snapshotId ?? 'snap-1', status: 'completed' }),
    ),
    pauseJob: vi.fn(async () => makeJob({ status: 'paused' })),
    resumeJob: vi.fn(async () => makeJob({ status: 'paused', snapshotId: 'snap-1' })),
    startMirrorPreview: vi.fn(async () => ({
      job: makeJob({ kind: 'mirror-serve', status: 'running' }),
      baseUrl: 'http://127.0.0.1:43111',
    })),
    stopMirrorPreview: vi.fn(async () => makeJob({ kind: 'mirror-serve', status: 'completed' })),
    openPath: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
  } as unknown as DesktopBridge;
}

describe('App readPreferredJobEvents event limits', () => {
  test('calls listJobEvents with limit 120 when verbosity=raw and preferred job is crawl', async () => {
    const crawlJob = makeJob({ kind: 'crawl', jobId: 'crawl-raw', snapshotId: 'snap-1' });
    const bridge = makeBridge([crawlJob], 'raw');
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    await waitFor(() =>
      expect(bridge.listJobEvents).toHaveBeenCalledWith('crawl-raw', 120),
    );
  });

  test('calls listJobEvents with limit 60 when verbosity=normal and preferred job is crawl', async () => {
    const crawlJob = makeJob({ kind: 'crawl', jobId: 'crawl-normal', snapshotId: 'snap-1' });
    const bridge = makeBridge([crawlJob], 'normal');
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    await waitFor(() =>
      expect(bridge.listJobEvents).toHaveBeenCalledWith('crawl-normal', 60),
    );
  });

  test('calls listJobEvents with limit 80 when verbosity=raw and preferred job is snapshot-finalize', async () => {
    // No crawl job - falls back to snapshot-finalize job as the preferred job
    const finalizeJob = makeJob({
      kind: 'snapshot-finalize',
      jobId: 'finalize-1',
      snapshotId: 'snap-1',
    });
    const bridge = makeBridge([finalizeJob], 'raw');
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    await waitFor(() =>
      expect(bridge.listJobEvents).toHaveBeenCalledWith('finalize-1', 80),
    );
  });

  test('calls listJobEvents with limit 40 when verbosity=verbose and preferred job is mirror-build', async () => {
    const mirrorJob = makeJob({
      kind: 'mirror-build',
      jobId: 'mirror-b-1',
      snapshotId: 'snap-1',
    });
    const bridge = makeBridge([mirrorJob], 'verbose');
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    await waitFor(() =>
      expect(bridge.listJobEvents).toHaveBeenCalledWith('mirror-b-1', 40),
    );
  });

  test('calls listJobEvents with limit 18 when verbosity=normal and preferred job is mirror-build', async () => {
    const mirrorJob = makeJob({
      kind: 'mirror-build',
      jobId: 'mirror-b-2',
      snapshotId: 'snap-1',
    });
    const bridge = makeBridge([mirrorJob], 'normal');
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    await waitFor(() =>
      expect(bridge.listJobEvents).toHaveBeenCalledWith('mirror-b-2', 18),
    );
  });

  test('listJobEvents catch returns empty array when it rejects', async () => {
    const crawlJob = makeJob({ kind: 'crawl', jobId: 'crawl-err', snapshotId: 'snap-1' });
    const bridge = makeBridge([crawlJob], 'normal');
    (bridge.listJobEvents as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('event fetch failed'),
    );
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    // The app should render without crashing even though listJobEvents rejects
    expect(await screen.findByRole('main')).toBeInTheDocument();
  });

  test('crawl job matching snapshotId is preferred over crawl job not matching', async () => {
    // A crawl job with snapshotId matching selectedSnapshotId should be preferred
    // over a crawl job that doesn't match. This exercises the first find() branch
    // in readPreferredJobEvents (line 692 match with snapshotId)
    const crawlOldSnap = makeJob({ kind: 'crawl', jobId: 'crawl-old', snapshotId: 'snap-old' });
    const crawlCurrentSnap = makeJob({
      kind: 'crawl',
      jobId: 'crawl-current',
      snapshotId: 'snap-1',
    });
    const bridge = makeBridge([crawlOldSnap, crawlCurrentSnap], 'normal');
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    await waitFor(() =>
      expect(bridge.listJobEvents).toHaveBeenCalledWith('crawl-current', 60),
    );
  });
});
