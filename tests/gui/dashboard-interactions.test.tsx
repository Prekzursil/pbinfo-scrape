import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/gui/renderer/app.js';
import { createBridgeHarness } from './_helpers/desktop-bridge-harness.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function ready(): Promise<void> {
  await screen.findByRole('heading', { name: 'Problem Archive Crawler' });
}

describe('dashboard interactions', () => {
  test('drives every operator action through the dashboard', async () => {
    const harness = createBridgeHarness();
    render(<App desktop={harness.bridge} />);
    await ready();

    // Top-bar refresh.
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));

    // Overview maintenance + crawl-loop + mirror-preview controls.
    fireEvent.click(await screen.findByRole('button', { name: /Normalize snapshot/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Rank sources/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Build mirror/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Finalize snapshot/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Resume crawl/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Pause after current chunk/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Start user crawl/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open in browser' }));

    await waitFor(() => {
      const kinds = harness.startJob.mock.calls.map((call) => call[0].kind);
      expect(kinds).toEqual(
        expect.arrayContaining(['normalize', 'rank', 'mirror-build', 'snapshot-finalize']),
      );
    });
    expect((harness.bridge.resumeJob as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((harness.bridge.pauseJob as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((harness.bridge.startMirrorPreview as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((harness.bridge.stopMirrorPreview as ReturnType<typeof vi.fn>)).toHaveBeenCalled();

    // Setup tab: snapshot edit, profile activate/delete, login + import forms.
    fireEvent.click(await screen.findByRole('tab', { name: 'Setup' }));
    fireEvent.change(await screen.findByPlaceholderText('acceptance-20260310b'), {
      target: { value: 'snap-edit' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    fireEvent.change(screen.getAllByLabelText('Profile id')[0]!, { target: { value: 'login-1' } });
    fireEvent.change(screen.getAllByLabelText('Label')[0]!, { target: { value: 'Login One' } });
    fireEvent.change(screen.getAllByLabelText('User handle')[0]!, { target: { value: 'handleA' } });
    fireEvent.change(screen.getAllByLabelText('User handle')[0]!, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'user' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    fireEvent.change(screen.getAllByLabelText('Profile id')[1]!, { target: { value: 'import-1' } });
    fireEvent.change(screen.getAllByLabelText('Label')[1]!, { target: { value: 'Import One' } });
    fireEvent.change(screen.getByLabelText('Browser'), { target: { value: 'chrome' } });
    fireEvent.change(screen.getByLabelText('Browser profile'), { target: { value: 'Default' } });
    fireEvent.change(screen.getByLabelText('Browser profile'), { target: { value: '' } });
    fireEvent.change(screen.getAllByLabelText('User handle')[1]!, { target: { value: 'handleB' } });
    fireEvent.change(screen.getAllByLabelText('User handle')[1]!, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import browser cookies' }));

    await waitFor(() => {
      expect((harness.bridge.activateProfile as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('alpha');
      expect((harness.bridge.deleteProfile as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('alpha');
      expect((harness.bridge.loginProfile as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      expect((harness.bridge.importBrowserProfile as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });

    // Data tab: dataset switch, record selection, and folder/mirror openers.
    fireEvent.click(await screen.findByRole('tab', { name: 'Data' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open mirror output folder' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open mirror in browser' }));
    fireEvent.click((await screen.findAllByRole('listitem'))[0]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Open selected record file' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open record route in live mirror' }));
    fireEvent.click(await screen.findByRole('tab', { name: /Rankings/ }));
    await waitFor(() => {
      expect((harness.bridge.listArchiveExplorerRecords as ReturnType<typeof vi.fn>).mock.calls.some(
        (call) => call[0].dataset === 'rankings',
      )).toBe(true);
      expect((harness.bridge.getArchiveExplorerRecord as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
  });

  test('drives every coverage explorer filter and detail action', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.getCoverageRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshotId: 'acceptance-20260310b',
      coverageFilePath: 'C:/ws/coverage/problem-3716.json',
      record: {
        problemId: 3716,
        slug: 'crossword',
        name: 'Crossword',
        grade: 11,
        mirrorRoute: '/probleme/3716/crossword',
        tags: ['strings'],
        solvedByMe: true,
        evaluationCount: 1,
        solvedEvaluationCount: 1,
        rankingPresent: true,
        testsFragmentArchived: true,
        exampleTestsAvailableCount: 0,
        visibleTestsCapturedCount: 0,
        evaluationObservedTestsCount: 1,
        effectiveTestsAvailableCount: 0,
        testsCoverageStatus: 'captured' as const,
        officialSolutionPresent: true,
        officialSourceArchived: true,
        officialSourceCount: 1,
        officialSourceLanguages: ['cpp'],
        officialSourceStatus: 'archived' as const,
        userSourceArchived: true,
        userSourceCount: 1,
        userSourceLanguages: ['cpp'],
        requiredTrustworthyUserSourceLanguages: ['cpp'],
        trustworthyUserSourceLanguages: ['cpp'],
        bestTrustworthyUserPerLanguage: { cpp: 102, c: 101 },
        missingTrustworthyUserSourceLanguages: [],
        archiveCompletenessStatus: 'complete' as const,
        editorialAvailability: 'visible' as const,
        testsAvailable: true,
        unsolvedByConfiguredHandle: false,
        officialSourceBlocked: false,
        officialSourceBlockedReason: 'official-source-not-captured',
        notArchivedYet: false,
        newSinceBaseline: true,
        notes: ['note'],
        canonicalUrl: 'https://www.pbinfo.ro/probleme/3716/crossword',
        sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/3716/crossword',
        statementArchived: true,
        solutionFragmentArchived: true,
        hasAnyArchivedSource: true,
        evaluationIds: [63332367],
        bestUserOverallEvaluationId: 63332367,
      },
      rawRecordLinks: {
        coverageFilePath: 'C:/ws/coverage/problem-3716.json',
        problemFilePath: 'C:/ws/problems/problem-3716.json',
        rankingFilePath: 'C:/ws/rankings/problems/problem-3716.json',
        evaluationFilePaths: ['C:/ws/evaluations/evaluation-63332367.json'],
        officialSourceFilePaths: [],
        userSourceFilePaths: [],
      },
    });

    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('tab', { name: 'Coverage' }));

    for (const [label, value] of [
      ['Solved', 'solved'],
      ['Tests fragment archived', 'yes'],
      ['Visible tests captured', 'no'],
      ['Official source archived', 'yes'],
      ['User source archived', 'no'],
      ['Editorial', 'visible'],
      ['Archive state', 'missing-user-source'],
    ] as const) {
      fireEvent.change(await screen.findByLabelText(label), { target: { value } });
    }
    const gradeInput = await screen.findByLabelText('Grade filter');
    fireEvent.change(gradeInput, { target: { value: '11' } });
    fireEvent.change(gradeInput, { target: { value: '' } });

    fireEvent.click(await screen.findByRole('button', { name: /#3716/ }));
    for (const name of [
      'Open coverage record',
      'Open problem record',
      'Open ranking record',
      'Open first evaluation record',
      'Open in live mirror',
      'Open source list upstream',
    ]) {
      fireEvent.click(await screen.findByRole('button', { name }));
    }

    await waitFor(() => {
      expect((harness.bridge.openPath as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        'C:/ws/rankings/problems/problem-3716.json',
      );
      expect((harness.bridge.openExternal as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
    expect((await screen.findAllByText(/cpp -> 102/)).length).toBeGreaterThanOrEqual(1);
  });

  test('drives the overview status board controls and quick navigations', async () => {
    const harness = createBridgeHarness();
    render(<App desktop={harness.bridge} />);
    await ready();

    fireEvent.click(await screen.findByRole('button', { name: 'Verbose' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Raw' }));

    for (const copy of [
      /Problems solved by your archived handle/,
      /Problems still unsolved by the configured handle/,
      /already have the archive pieces/,
      /Actionable official-source capture gaps/,
      /missing a trustworthy best-per-language user source/,
      /Problems whose tests still need to be captured/,
    ]) {
      fireEvent.click(await screen.findByRole('button', { name: copy }));
    }
    fireEvent.click(await screen.findByRole('button', { name: 'Reset board focus' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Open full coverage explorer' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Overview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open coverage' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Overview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open raw data' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Overview' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open coverage detail' }))[0]!);

    await waitFor(() => {
      expect((harness.bridge.setVerbosityMode as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('raw');
    });
  });

  test('renders empty-state fallbacks with a sparse workspace', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.getWorkspaceState as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 1,
      workspaceRoot: 'C:/sparse',
      activeProfileId: undefined,
      profiles: [
        {
          profileId: 'no-handle',
          label: 'No handle profile',
          provenance: { type: 'cookie-import' },
          sessionCookiesPath: '.local/x.json',
          createdAt: '2026-03-10T12:00:00.000Z',
          updatedAt: '2026-03-10T12:00:00.000Z',
        },
      ],
      notifications: { desktopBanners: true, windowsToast: true },
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
    });
    (harness.bridge.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        jobId: 'crawl-nosnap',
        kind: 'crawl',
        status: 'paused',
        logPath: '.local/gui/logs/crawl-nosnap.jsonl',
        resumable: true,
        latestCounters: { pending: 3, completed: 1, inProgress: 0 },
        createdAt: '2026-03-10T12:00:00.000Z',
        updatedAt: '2026-03-10T12:05:00.000Z',
      },
    ]);
    (harness.bridge.getCrawlStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'));
    (harness.bridge.getCoverageSummary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'));
    (harness.bridge.listCoverageRecords as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshotId: 's',
      totalCount: 0,
      offset: 0,
      limit: 100,
      items: [],
    });

    render(<App desktop={harness.bridge} />);
    await ready();
    expect(await screen.findByText(/Crawl status will appear here/)).toBeInTheDocument();
    expect(await screen.findByText(/No problems match the current board focus/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('tab', { name: 'Setup' }));
    expect((await screen.findAllByText('No active profile')).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('No user handle saved')).toBeInTheDocument();
  });

  test('renders not-ready, learning-telemetry, custom-focus, and advanced diagnostic states', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.getCrawlStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshotId: 'acceptance-20260310b',
      queuePath: '.local/crawl-queues/acceptance-20260310b.sqlite',
      status: 'in_progress',
      pending: 5,
      completed: 1,
      inProgress: 0,
      publishEligible: false,
      recentFailures: [{ key: 'k', url: 'https://x/', attemptCount: 2, lastError: 'boom' }],
    });
    (harness.bridge.listJobEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (harness.bridge.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (harness.bridge.getArchiveExplorerSummary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'));
    (harness.bridge.getWorkspaceState as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 1,
      workspaceRoot: 'C:/ws',
      activeProfileId: undefined,
      profiles: [],
      notifications: { desktopBanners: false, windowsToast: false },
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
    });
    (harness.bridge.listCoverageRecords as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshotId: 'acceptance-20260310b',
      totalCount: 1,
      offset: 0,
      limit: 100,
      items: [
        {
          problemId: 77,
          slug: 'nogrades',
          name: 'No Grades',
          grade: undefined,
          mirrorRoute: '/probleme/77/nogrades',
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
          archiveCompletenessStatus: 'unsolved',
          editorialAvailability: 'unknown',
          testsAvailable: false,
          unsolvedByConfiguredHandle: true,
          officialSourceBlocked: false,
          notArchivedYet: false,
          newSinceBaseline: false,
          notes: [],
        },
      ],
    });

    render(<App desktop={harness.bridge} />);
    await ready();
    expect(await screen.findByText('Not ready')).toBeInTheDocument();
    expect(await screen.findByText(/ETA appears after enough crawl history/)).toBeInTheDocument();
    expect(await screen.findByText('#77 No Grades')).toBeInTheDocument();

    // Custom focus: a non-preset coverage filter makes the overview chip read "Custom focus".
    fireEvent.click(await screen.findByRole('tab', { name: 'Coverage' }));
    fireEvent.change(await screen.findByLabelText('Grade filter'), { target: { value: '11' } });
    fireEvent.click(await screen.findByRole('tab', { name: 'Overview' }));
    expect(await screen.findByText('Custom focus')).toBeInTheDocument();

    // Data view with no archive summary falls back to the "Not available" paths.
    fireEvent.click(await screen.findByRole('tab', { name: 'Data' }));
    expect((await screen.findAllByText('Not available')).length).toBeGreaterThanOrEqual(1);

    // Advanced diagnostics show disabled notifications and the latest failure message.
    fireEvent.click(await screen.findByRole('tab', { name: 'Setup' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Advanced Settings' }));
    expect((await screen.findAllByText('Disabled')).length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  test('renders without a bridge when window has no desktop API', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Problem Archive Crawler' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Choose a workspace' })).toBeInTheDocument();
  });

  test('bootstraps a workspace when none is selected yet', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.getWorkspaceState as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<App desktop={harness.bridge} />);
    await ready();

    const workspaceInput = await screen.findByPlaceholderText('C:/pbinfo-workspace');
    fireEvent.change(workspaceInput, { target: { value: 'C:/new-workspace' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Select workspace' }));

    await waitFor(() => {
      expect((harness.bridge.selectWorkspace as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        'C:/new-workspace',
      );
    });
  });

  test('surfaces bridge failures as error messages', async () => {
    const harness = createBridgeHarness();
    const boom = new Error('bridge unavailable');
    for (const method of [
      'getDesktopPreferences',
      'getArchiveExplorerSummary',
      'getCoverageSummary',
      'listCoverageRecords',
      'listArchiveExplorerRecords',
    ] as const) {
      (harness.bridge[method] as ReturnType<typeof vi.fn>).mockRejectedValue(boom);
    }
    render(<App desktop={harness.bridge} />);
    await ready();
    expect((await screen.findAllByText('bridge unavailable')).length).toBeGreaterThanOrEqual(1);
  });

  test('auto-resumes a paused resumable crawl loop', async () => {
    const harness = createBridgeHarness();
    const pausedJob = {
      jobId: 'crawl-loop',
      kind: 'crawl' as const,
      status: 'paused' as const,
      snapshotId: 'acceptance-20260310b',
      logPath: '.local/gui/logs/crawl-loop.jsonl',
      resumable: true,
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:05:00.000Z',
    };
    (harness.startJob as ReturnType<typeof vi.fn>).mockResolvedValue(pausedJob);
    (harness.bridge.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([pausedJob]);
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    await waitFor(
      () => {
        expect((harness.bridge.resumeJob as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
          'crawl-loop',
          expect.objectContaining({ maxIterations: 25 }),
        );
      },
      { timeout: 4000 },
    );
  });
});
