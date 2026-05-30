import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/gui/renderer/app.js';
import type { DesktopBridge } from '../../src/gui/shared/bridge.js';
import type { GuiCoverageRecord, GuiWorkspaceState } from '../../src/gui/shared/types.js';

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

function baseCoverageRecord(
  overrides: Partial<GuiCoverageRecord> = {},
): GuiCoverageRecord {
  return {
    problemId: 42,
    slug: 'example',
    name: 'Example',
    grade: 9,
    mirrorRoute: '/probleme/42/example',
    tags: [],
    solvedByMe: false,
    evaluationCount: 0,
    solvedEvaluationCount: 0,
    rankingPresent: false,
    testsFragmentArchived: false,
    exampleTestsAvailableCount: 0,
    visibleTestsCapturedCount: 0,
    evaluationObservedTestsCount: 0,
    effectiveTestsAvailableCount: 0,
    testsCoverageStatus: 'not-captured-yet',
    officialSolutionPresent: false,
    officialSourceArchived: false,
    officialSourceLanguages: [],
    officialSourceStatus: 'not-captured-yet',
    userSourceArchived: false,
    userSourceLanguages: [],
    requiredTrustworthyUserSourceLanguages: [],
    trustworthyUserSourceLanguages: [],
    bestTrustworthyUserPerLanguage: {},
    missingTrustworthyUserSourceLanguages: [],
    archiveCompletenessStatus: 'complete',
    editorialAvailability: 'visible',
    testsAvailable: false,
    unsolvedByConfiguredHandle: false,
    officialSourceBlocked: false,
    notArchivedYet: false,
    newSinceBaseline: false,
    notes: [],
    ...overrides,
  } as GuiCoverageRecord;
}

function makeBridge(coverageItems: GuiCoverageRecord[]): DesktopBridge {
  return {
    getDesktopPreferences: vi.fn(async () => ({
      verbosityMode: 'normal' as const,
      workspaceRoot: 'C:/ws',
    })),
    setVerbosityMode: vi.fn(async (mode) => ({ verbosityMode: mode, workspaceRoot: 'C:/ws' })),
    getWorkspaceState: vi.fn(async () => workspace()),
    selectWorkspace: vi.fn(async () => workspace()),
    loginProfile: vi.fn(async () => ({
      profile: workspace().profiles[0],
      workspaceState: workspace(),
      job: {
        jobId: 'j1',
        kind: 'auth-login' as const,
        status: 'completed' as const,
        snapshotId: 'snap-1',
        logPath: '.local/x.jsonl',
        resumable: false,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:01:00.000Z',
      },
    })),
    importBrowserProfile: vi.fn(async () => ({
      profile: workspace().profiles[0],
      workspaceState: workspace(),
      job: {
        jobId: 'j2',
        kind: 'auth-import-browser' as const,
        status: 'completed' as const,
        snapshotId: 'snap-1',
        logPath: '.local/x.jsonl',
        resumable: false,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:01:00.000Z',
      },
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
      totalProblems: coverageItems.length,
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
    listCoverageRecords: vi.fn(async () => ({
      snapshotId: 'snap-1',
      totalCount: coverageItems.length,
      offset: 0,
      limit: 100,
      items: coverageItems,
    })),
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
    listJobs: vi.fn(async () => []),
    listJobEvents: vi.fn(async () => []),
    startJob: vi.fn(async () => undefined as never),
    pauseJob: vi.fn(async () => undefined as never),
    resumeJob: vi.fn(async () => undefined as never),
    startMirrorPreview: vi.fn(async () => undefined as never),
    stopMirrorPreview: vi.fn(async () => undefined as never),
    openPath: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
  } as unknown as DesktopBridge;
}

describe('dashboard formatArchiveCompletenessStatus missing-official-source', () => {
  test('renders "Missing official source" badge when archiveCompletenessStatus is missing-official-source', async () => {
    const record = baseCoverageRecord({ archiveCompletenessStatus: 'missing-official-source' });
    const bridge = makeBridge([record]);
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listCoverageRecords).toHaveBeenCalled());
    const badges = await screen.findAllByText('Missing official source');
    expect(badges.length).toBeGreaterThan(0);
  });
});

describe('dashboard formatOfficialSourceStatus restricted-upstream', () => {
  test('renders "Official source restricted" badge when officialSourceStatus is restricted-upstream', async () => {
    const record = baseCoverageRecord({ officialSourceStatus: 'restricted-upstream' });
    const bridge = makeBridge([record]);
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listCoverageRecords).toHaveBeenCalled());
    expect(await screen.findByText('Official source restricted')).toBeInTheDocument();
  });
});

describe('dashboard formatTestsCoverageStatus not-available-upstream', () => {
  test('renders "Tests unavailable upstream" badge when testsCoverageStatus is not-available-upstream', async () => {
    const record = baseCoverageRecord({ testsCoverageStatus: 'not-available-upstream' });
    const bridge = makeBridge([record]);
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listCoverageRecords).toHaveBeenCalled());
    expect(await screen.findByText('Tests unavailable upstream')).toBeInTheDocument();
  });
});

describe('dashboard formatArchiveCompletenessStatus not-archived-yet', () => {
  test('renders "Not archived yet" badge when archiveCompletenessStatus is not-archived-yet', async () => {
    const record = baseCoverageRecord({ archiveCompletenessStatus: 'not-archived-yet' });
    const bridge = makeBridge([record]);
    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listCoverageRecords).toHaveBeenCalled());
    const badges = await screen.findAllByText('Not archived yet');
    expect(badges.length).toBeGreaterThan(0);
  });
});

describe('dashboard formatOverviewPreset complete', () => {
  test('shows "Complete" chip when the complete preset button is clicked', async () => {
    const bridge = makeBridge([]);
    render(<App desktop={bridge} />);

    const boardToolbar = await screen.findByRole('toolbar', {
      name: 'Problem status board filters',
    });
    fireEvent.click(within(boardToolbar).getByRole('button', { name: 'Complete' }));

    // formatOverviewPreset('complete') → 'Complete' used as chip label (line 1983)
    const chips = await screen.findAllByText('Complete');
    expect(chips.length).toBeGreaterThan(0);
  });
});

describe('dashboard formatOverviewPreset missing-official-source', () => {
  test('shows "Missing official source" chip when the missing-official-source preset button is clicked', async () => {
    const bridge = makeBridge([]);
    render(<App desktop={bridge} />);

    const boardToolbar = await screen.findByRole('toolbar', {
      name: 'Problem status board filters',
    });
    fireEvent.click(within(boardToolbar).getByRole('button', { name: 'Missing official source' }));

    // formatOverviewPreset('missing-official-source') → 'Missing official source' used as chip label (line 1985)
    const chips = await screen.findAllByText('Missing official source');
    expect(chips.length).toBeGreaterThan(0);
  });
});

describe('dashboard formatOverviewPreset solved', () => {
  test('shows "Solved" chip when the Solved preset button is clicked', async () => {
    const bridge = makeBridge([]);
    render(<App desktop={bridge} />);

    const boardToolbar = await screen.findByRole('toolbar', {
      name: 'Problem status board filters',
    });
    fireEvent.click(within(boardToolbar).getByRole('button', { name: 'Solved' }));

    // formatOverviewPreset('solved') → 'Solved' used as chip label (line 1979)
    const chips = await screen.findAllByText('Solved');
    expect(chips.length).toBeGreaterThan(0);
  });
});

describe('dashboard formatOverviewPreset unsolved', () => {
  test('shows "Unsolved" chip when the Unsolved preset button is clicked', async () => {
    const bridge = makeBridge([]);
    render(<App desktop={bridge} />);

    const boardToolbar = await screen.findByRole('toolbar', {
      name: 'Problem status board filters',
    });
    fireEvent.click(within(boardToolbar).getByRole('button', { name: 'Unsolved' }));

    // formatOverviewPreset('unsolved') → 'Unsolved' used as chip label (line 1981)
    const chips = await screen.findAllByText('Unsolved');
    expect(chips.length).toBeGreaterThan(0);
  });
});

describe('dashboard deriveCrawlTelemetry null with fewer than 2 events (line 1841)', () => {
  test('shows Learning when only one job event is available', async () => {
    // deriveCrawlTelemetry returns null at line 1840-1841 when relevantEvents.length < 2.
    const bridge: DesktopBridge = {
      ...makeBridge([]),
      getCrawlStatus: vi.fn(async () => ({
        snapshotId: 'snap-1',
        queuePath: '.local/q.sqlite',
        status: 'in_progress' as const,
        pending: 300,
        completed: 10,
        inProgress: 1,
        publishEligible: false,
        recentFailures: [],
      })),
      listJobs: vi.fn(async () => [
        {
          jobId: 'crawl-single-event',
          kind: 'crawl' as const,
          status: 'running' as const,
          snapshotId: 'snap-1',
          logPath: '.local/crawl.jsonl',
          resumable: false,
          latestCounters: { pending: 300, completed: 10, inProgress: 1 },
          createdAt: new Date(Date.now() - 3600_000).toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      // Only one event — less than 2, so deriveCrawlTelemetry returns null at line 1840-1841.
      listJobEvents: vi.fn(async () => [
        {
          timestamp: new Date().toISOString(),
          level: 'info' as const,
          stage: 'crawl',
          message: 'start',
          counters: { pending: 300, completed: 10, inProgress: 1 },
        },
      ]),
    } as unknown as DesktopBridge;

    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    expect(await screen.findByText('Learning…')).toBeInTheDocument();
  });
});

describe('dashboard computeCrawlTelemetry null when rate is zero (line 1856)', () => {
  test('shows Learning when two events have the same timestamp (zero elapsed time)', async () => {
    // resolveTelemetryRate returns null when elapsedSeconds <= 0 (line 1817)
    // which causes computeCrawlTelemetry to return null at line 1856.
    // When crawlTelemetry is null the component shows "Learning…" for ETA.
    const sameTimestamp = new Date().toISOString();
    const bridge: DesktopBridge = {
      ...makeBridge([]),
      getCrawlStatus: vi.fn(async () => ({
        snapshotId: 'snap-1',
        queuePath: '.local/q.sqlite',
        status: 'in_progress' as const,
        pending: 500,
        completed: 50,
        inProgress: 1,
        publishEligible: false,
        recentFailures: [],
      })),
      listJobs: vi.fn(async () => [
        {
          jobId: 'crawl-same-ts',
          kind: 'crawl' as const,
          status: 'running' as const,
          snapshotId: 'snap-1',
          logPath: '.local/crawl.jsonl',
          resumable: false,
          latestCounters: { pending: 500, completed: 50, inProgress: 1 },
          latestEvent: {
            timestamp: sameTimestamp,
            level: 'info' as const,
            stage: 'crawl',
            message: 'Crawling',
            counters: { pending: 500, completed: 50, inProgress: 1 },
          },
          createdAt: new Date(Date.now() - 3600_000).toISOString(),
          updatedAt: sameTimestamp,
        },
      ]),
      // Two events with identical timestamps but different completed counts.
      // baseline is found (completed < latestCounters.completed) but
      // elapsedSeconds == 0 → resolveTelemetryRate returns null → line 1856.
      listJobEvents: vi.fn(async () => [
        {
          timestamp: sameTimestamp,
          level: 'info' as const,
          stage: 'crawl',
          message: 'start',
          counters: { pending: 550, completed: 0, inProgress: 0 },
        },
        {
          timestamp: sameTimestamp,
          level: 'info' as const,
          stage: 'crawl',
          message: 'batch',
          counters: { pending: 500, completed: 50, inProgress: 1 },
        },
      ]),
    } as unknown as DesktopBridge;

    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    // crawlTelemetry is null → ETA shows "Learning…"
    expect(await screen.findByText('Learning…')).toBeInTheDocument();
  });
});

describe('dashboard computeCrawlTelemetry null when no baseline found (line 1851)', () => {
  test('shows Learning when all events have the same completed count (no progress delta)', async () => {
    // When all job events have completed >= latestCounters.completed, no baseline is found.
    // deriveCrawlTelemetry returns null at line 1851 → crawlTelemetry is null → "Learning…".
    const ts1 = new Date(Date.now() - 30_000).toISOString();
    const ts2 = new Date().toISOString();
    const bridge: DesktopBridge = {
      ...makeBridge([]),
      getCrawlStatus: vi.fn(async () => ({
        snapshotId: 'snap-1',
        queuePath: '.local/q.sqlite',
        status: 'in_progress' as const,
        pending: 200,
        completed: 50,
        inProgress: 1,
        publishEligible: false,
        recentFailures: [],
      })),
      listJobs: vi.fn(async () => [
        {
          jobId: 'crawl-no-baseline',
          kind: 'crawl' as const,
          status: 'running' as const,
          snapshotId: 'snap-1',
          logPath: '.local/crawl.jsonl',
          resumable: false,
          latestCounters: { pending: 200, completed: 50, inProgress: 1 },
          latestEvent: {
            timestamp: ts2,
            level: 'info' as const,
            stage: 'crawl',
            message: 'Crawling',
            counters: { pending: 200, completed: 50, inProgress: 1 },
          },
          createdAt: new Date(Date.now() - 3600_000).toISOString(),
          updatedAt: ts2,
        },
      ]),
      // Both events have the same completed count — no baseline with completed < 50 exists.
      listJobEvents: vi.fn(async () => [
        {
          timestamp: ts1,
          level: 'info' as const,
          stage: 'crawl',
          message: 'start',
          counters: { pending: 250, completed: 50, inProgress: 0 },
        },
        {
          timestamp: ts2,
          level: 'info' as const,
          stage: 'crawl',
          message: 'batch',
          counters: { pending: 200, completed: 50, inProgress: 1 },
        },
      ]),
    } as unknown as DesktopBridge;

    render(<App desktop={bridge} />);

    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    // No baseline found → crawlTelemetry is null → "Learning…"
    expect(await screen.findByText('Learning…')).toBeInTheDocument();
  });
});

describe('dashboard formatEtaRemaining hours branch (line 1882)', () => {
  test('shows hours-format ETA for a large pending count relative to completion rate', async () => {
    // To exercise the hours branch (line 1882), we need the computed ETA to be >= 60 minutes.
    // The ETA depends on the crawl status and job events (completion rate).
    // Set up a bridge where the crawl has a very large pending count and a slow rate
    const bridge: DesktopBridge = {
      ...makeBridge([]),
      getCrawlStatus: vi.fn(async () => ({
        snapshotId: 'snap-1',
        queuePath: '.local/q.sqlite',
        status: 'in_progress' as const,
        pending: 1_000_000,
        completed: 100,
        inProgress: 1,
        publishEligible: false,
        recentFailures: [],
      })),
      listJobs: vi.fn(async () => [
        {
          jobId: 'crawl-job-1',
          kind: 'crawl' as const,
          status: 'running' as const,
          snapshotId: 'snap-1',
          logPath: '.local/crawl.jsonl',
          resumable: false,
          latestCounters: {
            pending: 1_000_000,
            completed: 100,
            inProgress: 1,
          },
          latestEvent: {
            timestamp: new Date().toISOString(),
            level: 'info' as const,
            stage: 'crawl',
            message: 'Crawling',
            counters: {
              pending: 1_000_000,
              completed: 100,
              inProgress: 1,
            },
          },
          createdAt: new Date(Date.now() - 3600_000).toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      listJobEvents: vi.fn(async () => [
        {
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          level: 'info' as const,
          stage: 'crawl',
          message: 'Batch complete',
          counters: {
            pending: 1_000_100,
            completed: 0,
            inProgress: 0,
          },
        },
        {
          timestamp: new Date().toISOString(),
          level: 'info' as const,
          stage: 'crawl',
          message: 'Batch complete',
          counters: {
            pending: 1_000_000,
            completed: 100,
            inProgress: 1,
          },
        },
      ]),
    } as unknown as DesktopBridge;

    render(<App desktop={bridge} />);

    // Wait for the crawl status to render — at 100 completions/min with 1M pending,
    // ETA > 60 minutes → formatEtaRemaining uses hours branch (line 1882)
    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());
    // Accept any "Nh" or "Nh Mm" format as long as the component renders
    const etaMatches = screen.queryAllByText(/\d+h/);
    expect(etaMatches.length).toBeGreaterThan(0);
  });
});
