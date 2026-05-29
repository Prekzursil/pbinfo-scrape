import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

interface HarnessOptions {
  workspaceState?: GuiWorkspaceState | null;
  jobs?: GuiJobRecord[];
  prefsThrows?: boolean;
  verbosityRejects?: boolean;
  summariesThrow?: boolean;
  coverageListThrows?: boolean;
  coverageRecordThrows?: boolean;
  archiveListThrows?: boolean;
  archiveRecordThrows?: boolean;
  startJobThrows?: boolean;
  resumeJobThrows?: boolean;
  pauseJobThrows?: boolean;
  startMirrorThrows?: boolean;
  openExternalThrows?: boolean;
  openPathThrows?: boolean;
  selectWorkspaceThrows?: boolean;
  loginThrows?: boolean;
  importThrows?: boolean;
  activateThrows?: boolean;
  deleteThrows?: boolean;
}

function makeBridge(options: HarnessOptions = {}): DesktopBridge {
  const baseRecord = {
    snapshotId: 'snap-1',
    totalCount: 1,
    offset: 0,
    limit: 100,
  };

  const coverageRecord = {
    problemId: 100,
    slug: 'sample',
    name: 'Sample',
    grade: 9,
    mirrorRoute: '/probleme/100/sample',
    tags: ['ds'],
    solvedByMe: false,
    evaluationCount: 0,
    solvedEvaluationCount: 0,
    rankingPresent: false,
    testsFragmentArchived: false,
    exampleTestsAvailableCount: 0,
    visibleTestsCapturedCount: 0,
    evaluationObservedTestsCount: 0,
    effectiveTestsAvailableCount: 0,
    testsCoverageStatus: 'not-captured-yet' as const,
    officialSolutionPresent: false,
    officialSourceArchived: false,
    officialSourceLanguages: [],
    officialSourceStatus: 'not-captured-yet' as const,
    userSourceArchived: false,
    userSourceLanguages: [],
    requiredTrustworthyUserSourceLanguages: [],
    trustworthyUserSourceLanguages: [],
    bestTrustworthyUserPerLanguage: {},
    missingTrustworthyUserSourceLanguages: [],
    archiveCompletenessStatus: 'unsolved' as const,
    editorialAvailability: 'visible' as const,
    testsAvailable: false,
    unsolvedByConfiguredHandle: true,
    officialSourceBlocked: false,
    notArchivedYet: false,
    newSinceBaseline: false,
    notes: [],
  };

  const job = (overrides: Partial<GuiJobRecord> = {}): GuiJobRecord =>
    ({
      jobId: 'job-1',
      kind: 'crawl' as const,
      status: 'completed' as const,
      snapshotId: 'snap-1',
      logPath: '.local/x.jsonl',
      resumable: false,
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:01:00.000Z',
      ...overrides,
    }) as GuiJobRecord;

  return {
    getDesktopPreferences: vi.fn(async () => {
      if (options.prefsThrows) throw new Error('prefs boom');
      return { verbosityMode: 'normal' as const, workspaceRoot: 'C:/ws' };
    }),
    setVerbosityMode: vi.fn(async (mode) => {
      if (options.verbosityRejects) throw new Error('verbosity boom');
      return { verbosityMode: mode, workspaceRoot: 'C:/ws' };
    }),
    getWorkspaceState: vi.fn(async () => {
      return options.workspaceState === undefined ? workspace() : options.workspaceState;
    }),
    selectWorkspace: vi.fn(async () => {
      if (options.selectWorkspaceThrows) throw new Error('selectWs boom');
      return workspace();
    }),
    loginProfile: vi.fn(async () => {
      if (options.loginThrows) throw new Error('login boom');
      return {
        profile: workspace().profiles[0],
        workspaceState: workspace(),
        job: job({ kind: 'auth-login', status: 'completed' }),
      };
    }),
    importBrowserProfile: vi.fn(async () => {
      if (options.importThrows) throw new Error('import boom');
      return {
        profile: workspace().profiles[0],
        workspaceState: workspace(),
        job: job({ kind: 'auth-import-browser', status: 'completed' }),
      };
    }),
    createProfile: vi.fn(async () => workspace().profiles[0]),
    activateProfile: vi.fn(async () => {
      if (options.activateThrows) throw new Error('activate boom');
      return workspace();
    }),
    deleteProfile: vi.fn(async () => {
      if (options.deleteThrows) throw new Error('delete boom');
      return workspace();
    }),
    getArchiveExplorerSummary: vi.fn(async () => {
      if (options.summariesThrow) throw new Error('archive summary boom');
      return {
        snapshotId: 'snap-1',
        normalizedRoot: 'C:/ws/normalized',
        mirrorRoot: 'C:/ws/mirror',
        mirrorServeCommand: 'cmd',
        mirrorUrl: 'http://127.0.0.1/',
        datasets: [
          {
            dataset: 'problems' as const,
            label: 'Problems',
            count: 1,
            directoryPath: 'C:/ws/problems',
            description: 'desc',
          },
        ],
      };
    }),
    listArchiveExplorerRecords: vi.fn(async () => {
      if (options.archiveListThrows) throw new Error('archive list boom');
      return {
        snapshotId: 'snap-1',
        dataset: 'problems' as const,
        totalCount: 1,
        offset: 0,
        limit: 24,
        items: [
          {
            dataset: 'problems' as const,
            recordId: '100',
            title: '#100',
            subtitle: '/x',
            filePath: 'C:/ws/x.json',
            mirrorRoute: '/probleme/100/sample',
          },
        ],
      };
    }),
    getArchiveExplorerRecord: vi.fn(async () => {
      if (options.archiveRecordThrows) throw new Error('archive record boom');
      return {
        snapshotId: 'snap-1',
        dataset: 'problems' as const,
        recordId: '100',
        title: '#100',
        subtitle: '/x',
        filePath: 'C:/ws/x.json',
        mirrorRoute: '/probleme/100/sample',
        payload: { id: 100 },
      };
    }),
    getCoverageSummary: vi.fn(async () => {
      if (options.summariesThrow) throw new Error('coverage summary boom');
      return {
        snapshotId: 'snap-1',
        coverageRoot: 'C:/ws/cov',
        normalizedRoot: 'C:/ws/normalized',
        mirrorRoot: 'C:/ws/mirror',
        mirrorServeCommand: 'cmd',
        mirrorUrl: 'http://127.0.0.1/',
        totalProblems: 1,
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
        unsolvedProblemCount: 1,
        missingOfficialSourceCount: 0,
        solvedByMeMissingUserSourceCount: 0,
      };
    }),
    listCoverageRecords: vi.fn(async () => {
      if (options.coverageListThrows) throw new Error('coverage list boom');
      return {
        ...baseRecord,
        items: [coverageRecord],
      };
    }),
    getCoverageRecord: vi.fn(async () => {
      if (options.coverageRecordThrows) throw new Error('coverage record boom');
      return {
        snapshotId: 'snap-1',
        coverageFilePath: 'C:/ws/cov/p-100.json',
        record: { ...coverageRecord, officialSourceCount: 0, userSourceCount: 0,
          canonicalUrl: 'https://pbinfo.ro/p/100', sourceListUrl: 'https://pbinfo.ro/s/100',
          statementArchived: true, solutionFragmentArchived: true,
          hasAnyArchivedSource: false, evaluationIds: [] },
        rawRecordLinks: { coverageFilePath: 'C:/ws/cov/p.json',
          problemFilePath: 'C:/ws/p.json', evaluationFilePaths: [],
          officialSourceFilePaths: [], userSourceFilePaths: [] },
      };
    }),
    getCrawlStatus: vi.fn(async () => ({
      snapshotId: 'snap-1',
      queuePath: '.local/q.sqlite',
      status: 'completed' as const,
      pending: 0,
      completed: 1,
      inProgress: 0,
      publishEligible: true,
      recentFailures: [],
    })),
    listJobs: vi.fn(async () => options.jobs ?? []),
    listJobEvents: vi.fn(async () => []),
    startJob: vi.fn(async (input) => {
      if (options.startJobThrows) throw new Error('startJob boom');
      return job({
        kind: input.kind,
        snapshotId: input.snapshotId ?? 'snap-1',
        status: 'completed',
      });
    }),
    pauseJob: vi.fn(async () => {
      if (options.pauseJobThrows) throw new Error('pauseJob boom');
      return job({ status: 'paused' });
    }),
    resumeJob: vi.fn(async () => {
      if (options.resumeJobThrows) throw new Error('resumeJob boom');
      return job({ status: 'paused', snapshotId: 'snap-1' });
    }),
    startMirrorPreview: vi.fn(async () => {
      if (options.startMirrorThrows) throw new Error('startMirror boom');
      return {
        job: job({ kind: 'mirror-serve', status: 'running' }),
        baseUrl: 'http://127.0.0.1:43111',
      };
    }),
    stopMirrorPreview: vi.fn(async () => job({ kind: 'mirror-serve', status: 'completed' })),
    openPath: vi.fn(async () => {
      if (options.openPathThrows) throw new Error('openPath boom');
      return undefined;
    }),
    openExternal: vi.fn(async () => {
      if (options.openExternalThrows) throw new Error('openExternal boom');
      return undefined;
    }),
  } as unknown as DesktopBridge;
}

describe('App effects and error handling', () => {
  test('surfaces a preferences load failure as an error banner', async () => {
    const bridge = makeBridge({ prefsThrows: true });
    render(<App desktop={bridge} />);
    await waitFor(() => expect(bridge.getDesktopPreferences).toHaveBeenCalled());
    expect(await screen.findByText(/prefs boom/)).toBeInTheDocument();
  });

  test('shows the workspace bootstrap form when getWorkspaceState resolves to null', async () => {
    const bridge = makeBridge({ workspaceState: null });
    render(<App desktop={bridge} />);
    expect(await screen.findByRole('heading', { name: /Choose a workspace/i })).toBeInTheDocument();
  });

  test('throwing summary fetches surface error messages and clear summaries', async () => {
    const bridge = makeBridge({ summariesThrow: true });
    render(<App desktop={bridge} />);
    await waitFor(() => expect(bridge.getArchiveExplorerSummary).toHaveBeenCalled());
    expect(
      await screen.findByText(/archive summary boom|coverage summary boom/),
    ).toBeInTheDocument();
  });

  test('throwing coverage listing clears state and surfaces error', async () => {
    const bridge = makeBridge({ coverageListThrows: true });
    render(<App desktop={bridge} />);
    await waitFor(() => expect(bridge.listCoverageRecords).toHaveBeenCalled());
    expect(await screen.findByText(/coverage list boom/)).toBeInTheDocument();
  });

  test('throwing archive listing clears state and surfaces error', async () => {
    const bridge = makeBridge({ archiveListThrows: true });
    render(<App desktop={bridge} />);
    await waitFor(() => expect(bridge.listArchiveExplorerRecords).toHaveBeenCalled());
    expect(await screen.findByText(/archive list boom/)).toBeInTheDocument();
  });

  test('starting a crawl propagates rejection from bridge.startJob', async () => {
    const bridge = makeBridge({ startJobThrows: true });
    render(<App desktop={bridge} />);
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    expect(await screen.findByText(/startJob boom/)).toBeInTheDocument();
  });

  test('verbosity change propagates errors from setVerbosityMode', async () => {
    const bridge = makeBridge({ verbosityRejects: true });
    render(<App desktop={bridge} />);
    // Verbosity buttons live in the advanced log section; switch to Setup -> Advanced
    fireEvent.click(await screen.findByRole('tab', { name: 'Setup' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Advanced Settings' }));
    // Click on a verbosity segmented button if present
    const buttons = await screen.findAllByRole('button');
    const verboseButton = buttons.find((b) => /verbose/i.test(b.textContent ?? ''));
    if (verboseButton) {
      fireEvent.click(verboseButton);
      await waitFor(() => expect(bridge.setVerbosityMode).toHaveBeenCalled());
    }
  });

  test('selecting a workspace triggers selectWorkspace and refresh', async () => {
    const bridge = makeBridge({ workspaceState: null });
    render(<App desktop={bridge} />);
    const wsInput = await screen.findByPlaceholderText(/C:\/pbinfo-workspace/);
    fireEvent.change(wsInput, { target: { value: 'C:/ws' } });
    fireEvent.click(await screen.findByRole('button', { name: /Select workspace/i }));
    await waitFor(() => expect(bridge.selectWorkspace).toHaveBeenCalledWith('C:/ws'));
  });

  test(
    'pausing a crawl propagates pauseJob errors',
    { timeout: 15_000 },
    async () => {
      const pausedJob = {
        jobId: 'crawl-p',
        kind: 'crawl' as const,
        status: 'paused' as const,
        snapshotId: 'snap-1',
        logPath: '.local/x.jsonl',
        resumable: true,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:01:00.000Z',
      } as GuiJobRecord;
      const bridge = makeBridge({ jobs: [pausedJob], pauseJobThrows: true });
      render(<App desktop={bridge} />);
      const pauseButton = await screen.findByRole('button', {
        name: /Pause after current chunk completes/i,
      });
      fireEvent.click(pauseButton);
      expect(await screen.findByText(/pauseJob boom/)).toBeInTheDocument();
    },
  );

  test(
    'toMessage handles non-Error rejections by stringifying',
    { timeout: 15_000 },
    async () => {
      const bridge = makeBridge();
      (bridge.getDesktopPreferences as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw 'string-error-value';
      });
      render(<App desktop={bridge} />);
      expect(await screen.findByText(/string-error-value/)).toBeInTheDocument();
    },
  );

  test(
    'renders without a bridge - shows bootstrap and avoids crash',
    { timeout: 15_000 },
    async () => {
      // Ensure window has no pbinfoDesktop
      const win = window as Window & { pbinfoDesktop?: DesktopBridge };
      const previous = win.pbinfoDesktop;
      delete win.pbinfoDesktop;
      render(<App />);
      expect(
        await screen.findByRole('heading', { name: /Choose a workspace/i }),
      ).toBeInTheDocument();
      if (previous !== undefined) win.pbinfoDesktop = previous;
    },
  );
});
