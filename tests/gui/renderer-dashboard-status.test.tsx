import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
