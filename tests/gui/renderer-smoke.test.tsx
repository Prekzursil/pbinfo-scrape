import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { App } from '../../src/gui/renderer/app.js';
import type { DesktopBridge } from '../../src/gui/shared/bridge.js';

afterEach(() => {
  cleanup();
});

test('renders the simplified easy-mode overview before exposing deeper tools', { timeout: 60_000 }, async () => {
  const harness = createBridgeHarness();
  render(<App desktop={harness.bridge} />);

  expect(await screen.findByRole('heading', { name: 'Problem Archive Crawler' })).toBeInTheDocument();
  expect(await screen.findByText('PBInfo archival operator console')).toBeInTheDocument();
  expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByRole('tab', { name: 'Coverage' })).toBeInTheDocument();
  expect(await screen.findByRole('tab', { name: 'Data' })).toBeInTheDocument();
  expect(await screen.findByRole('tab', { name: 'Setup' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Archive Overview' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Problem Status Board' })).toBeInTheDocument();
  const boardToolbar = await screen.findByRole('toolbar', {
    name: 'Problem status board filters',
  });
  expect(within(boardToolbar).getByRole('button', { name: 'Missing official source' })).toBeInTheDocument();
  expect(within(boardToolbar).getByRole('button', { name: 'Missing your source' })).toBeInTheDocument();
  expect(await screen.findByText('Upstream unavailable')).toBeInTheDocument();
  expect(await screen.findByText(/12 official and 8 tests/i)).toBeInTheDocument();
  expect(await screen.findByText('C:/archive-workspace')).toBeInTheDocument();
  expect(await screen.findByText('Primary account')).toBeInTheDocument();
  expect(await screen.findByText('42 pending')).toBeInTheDocument();
  expect(await screen.findByText(/7m remaining/i)).toBeInTheDocument();
  expect(await screen.findByText(/6.0 completed\/min/i)).toBeInTheDocument();
  expect(await screen.findByLabelText('Crawl mode')).toHaveValue('incremental');
  expect(await screen.findByRole('button', { name: /Start full crawl/i })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Open in browser' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Show embedded preview' })).toBeInTheDocument();
  expect(screen.queryByTitle('Mirror preview')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Coverage Explorer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Data Explorer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Profiles & Access' })).not.toBeInTheDocument();
  expect(await screen.findByText(/publish --snapshot acceptance-20260310b/)).toBeInTheDocument();
});

test('lets the user move through overview, coverage, data, and setup without overload', { timeout: 60_000 }, async () => {
  const harness = createBridgeHarness();
  render(<App desktop={harness.bridge} />);

  const crawlModeSelect = await screen.findByLabelText('Crawl mode');
  fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
  expect(await screen.findByText('Started all crawl')).toBeInTheDocument();
  fireEvent.change(crawlModeSelect, {
    target: {
      value: 'fresh',
    },
  });
  expect(crawlModeSelect).toHaveValue('fresh');
  fireEvent.click(await screen.findByRole('button', { name: /Start public crawl/i }));
  expect(await screen.findByText('Started public crawl')).toBeInTheDocument();

  const boardToolbar = await screen.findByRole('toolbar', {
    name: 'Problem status board filters',
  });
  fireEvent.click(within(boardToolbar).getByRole('button', { name: 'Missing your source' }));
  expect(await screen.findByText('Your source missing')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Open mirror' }));
  expect(harness.openExternal).toHaveBeenCalledWith(
    'http://127.0.0.1:43111/probleme/3716/crossword',
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Open coverage detail' }));
  expect(await screen.findByRole('heading', { name: 'Coverage Explorer' })).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('tab', { name: 'Overview' }));
  const refreshedBoardToolbar = await screen.findByRole('toolbar', {
    name: 'Problem status board filters',
  });
  fireEvent.click(within(refreshedBoardToolbar).getByRole('button', { name: 'Missing tests' }));
  expect(await screen.findByText('Tests not captured yet')).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('button', { name: 'Show embedded preview' }));
  expect(await screen.findByTitle('Mirror preview')).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('tab', { name: 'Coverage' }));
  const coverageHeading = await screen.findByRole('heading', { name: 'Coverage Explorer' });
  const coverageWorkspace = coverageHeading.closest('section');
  expect(coverageWorkspace).toHaveClass('panel-workspace');
  expect(
    within(coverageWorkspace as HTMLElement).getByRole('toolbar', { name: 'Coverage filters' }),
  ).toBeInTheDocument();
  expect(within(coverageWorkspace as HTMLElement).getByLabelText('Tests status')).toBeInTheDocument();
  expect(within(coverageWorkspace as HTMLElement).getByLabelText('Archive state')).toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText('Tests status'), {
    target: {
      value: 'all',
    },
  });
  const coverageSearchInput = await screen.findByLabelText('Search problems');
  fireEvent.change(coverageSearchInput, {
    target: {
      value: 'crossword',
    },
  });
  expect((await screen.findAllByText(/Crossword/i)).length).toBeGreaterThanOrEqual(1);
  expect(await screen.findByText('Required solved languages')).toBeInTheDocument();
  expect(await screen.findByText('Official source not captured yet')).toBeInTheDocument();
  const solvedSelect = await screen.findByLabelText('Solved');
  fireEvent.change(solvedSelect, {
    target: {
      value: 'solved',
    },
  });
  expect((await screen.findAllByText('Solved')).length).toBeGreaterThanOrEqual(1);
  fireEvent.click(await screen.findByRole('button', { name: 'Open coverage record' }));
  expect(harness.openPath).toHaveBeenCalledWith(
    'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/problem-coverage/problem-3716.json',
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Open source list upstream' }));
  expect(harness.openExternal).toHaveBeenCalledWith(
    'https://www.pbinfo.ro/solutii/problema/3716/crossword',
  );

  fireEvent.click(await screen.findByRole('tab', { name: 'Data' }));
  const dataHeading = await screen.findByRole('heading', { name: 'Data Explorer' });
  const dataWorkspace = dataHeading.closest('section');
  expect(dataWorkspace).toHaveClass('panel-workspace');
  expect(
    within(dataWorkspace as HTMLElement).getByRole('toolbar', {
      name: 'Archive dataset browser',
    }),
  ).toBeInTheDocument();
  const datasetSearchInput = await screen.findByLabelText('Search current dataset');
  fireEvent.change(datasetSearchInput, {
    target: {
      value: 'waterreserve',
    },
  });
  expect((await screen.findAllByText('/probleme/3171/problem-3171')).length).toBeGreaterThanOrEqual(1);
  fireEvent.click(await screen.findByRole('button', { name: 'Open normalized archive folder' }));
  expect(harness.openPath).toHaveBeenCalledWith(
    'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized',
  );

  fireEvent.click(await screen.findByRole('tab', { name: 'Setup' }));
  expect(await screen.findByRole('heading', { name: 'Profiles & Access' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Advanced Settings' })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Advanced Settings' }));
  expect(await screen.findByRole('heading', { name: 'Advanced Settings' })).toBeInTheDocument();
});

function createBridgeHarness(): {
  bridge: DesktopBridge;
  startJob: ReturnType<typeof vi.fn>;
  openPath: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
} {
  const coverageRecords = [
    {
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
      effectiveTestsAvailableCount: 1,
      testsCoverageStatus: 'captured' as const,
      officialSolutionPresent: true,
      officialSourceArchived: false,
      officialSourceLanguages: [],
      officialSourceStatus: 'not-captured-yet' as const,
      userSourceArchived: false,
      userSourceLanguages: [],
      requiredTrustworthyUserSourceLanguages: ['c'],
      trustworthyUserSourceLanguages: [],
      bestTrustworthyUserPerLanguage: {},
      missingTrustworthyUserSourceLanguages: ['c'],
      archiveCompletenessStatus: 'missing-user-source' as const,
      editorialAvailability: 'visible' as const,
      testsAvailable: true,
      unsolvedByConfiguredHandle: false,
      officialSourceBlocked: true,
      officialSourceBlockedReason: 'official-source-not-captured',
      notArchivedYet: false,
      newSinceBaseline: false,
      notes: [
        'Tests fragment archived, no visible test cases parsed.',
        'Source list available upstream, no archived source code yet.',
      ],
    },
    {
      problemId: 3171,
      slug: 'waterreserve',
      name: 'waterreserve',
      grade: 9,
      mirrorRoute: '/probleme/3171/problem-3171',
      tags: ['graphs'],
      solvedByMe: true,
      evaluationCount: 2,
      solvedEvaluationCount: 2,
      rankingPresent: true,
      testsFragmentArchived: true,
      exampleTestsAvailableCount: 2,
      visibleTestsCapturedCount: 2,
      evaluationObservedTestsCount: 4,
      effectiveTestsAvailableCount: 4,
      testsCoverageStatus: 'captured' as const,
      officialSolutionPresent: true,
      officialSourceArchived: true,
      officialSourceLanguages: ['cpp'],
      officialSourceStatus: 'archived' as const,
      userSourceArchived: true,
      userSourceLanguages: ['c', 'cpp'],
      requiredTrustworthyUserSourceLanguages: ['c', 'cpp'],
      trustworthyUserSourceLanguages: ['c', 'cpp'],
      bestTrustworthyUserPerLanguage: { c: 101, cpp: 102 },
      missingTrustworthyUserSourceLanguages: [],
      archiveCompletenessStatus: 'complete' as const,
      editorialAvailability: 'visible' as const,
      testsAvailable: true,
      unsolvedByConfiguredHandle: false,
      officialSourceBlocked: false,
      notArchivedYet: false,
      newSinceBaseline: true,
      notes: ['Official and user sources archived.'],
    },
    {
      problemId: 19,
      slug: 'bfs',
      name: 'bfs',
      grade: 9,
      mirrorRoute: '/probleme/19/bfs',
      tags: ['graphs'],
      solvedByMe: false,
      evaluationCount: 0,
      solvedEvaluationCount: 0,
      rankingPresent: false,
      testsFragmentArchived: true,
      exampleTestsAvailableCount: 1,
      visibleTestsCapturedCount: 0,
      evaluationObservedTestsCount: 0,
      effectiveTestsAvailableCount: 1,
      testsCoverageStatus: 'captured' as const,
      officialSolutionPresent: true,
      officialSourceArchived: false,
      officialSourceLanguages: [],
      officialSourceStatus: 'not-available-upstream' as const,
      userSourceArchived: false,
      userSourceLanguages: [],
      requiredTrustworthyUserSourceLanguages: [],
      trustworthyUserSourceLanguages: [],
      bestTrustworthyUserPerLanguage: {},
      missingTrustworthyUserSourceLanguages: [],
      archiveCompletenessStatus: 'unsolved' as const,
      editorialAvailability: 'visible' as const,
      testsAvailable: true,
      unsolvedByConfiguredHandle: true,
      officialSourceBlocked: false,
      notArchivedYet: false,
      newSinceBaseline: false,
      notes: ['Official 100-point source body unavailable upstream.'],
    },
    {
      problemId: 5000,
      slug: 'edgecase',
      name: 'Edgecase',
      grade: 10,
      mirrorRoute: '/probleme/5000/edgecase',
      tags: ['math'],
      solvedByMe: true,
      evaluationCount: 1,
      solvedEvaluationCount: 1,
      rankingPresent: true,
      testsFragmentArchived: false,
      exampleTestsAvailableCount: 0,
      visibleTestsCapturedCount: 0,
      evaluationObservedTestsCount: 0,
      effectiveTestsAvailableCount: 0,
      testsCoverageStatus: 'not-captured-yet' as const,
      officialSolutionPresent: false,
      officialSourceArchived: false,
      officialSourceLanguages: [],
      officialSourceStatus: 'not-available-upstream' as const,
      userSourceArchived: true,
      userSourceLanguages: ['py'],
      requiredTrustworthyUserSourceLanguages: ['py'],
      trustworthyUserSourceLanguages: ['py'],
      bestTrustworthyUserPerLanguage: { py: 501 },
      missingTrustworthyUserSourceLanguages: [],
      archiveCompletenessStatus: 'incomplete' as const,
      editorialAvailability: 'hidden' as const,
      testsAvailable: false,
      unsolvedByConfiguredHandle: false,
      officialSourceBlocked: false,
      notArchivedYet: false,
      newSinceBaseline: false,
      notes: ['Tests still need to be captured.'],
    },
  ];
  const startJob = vi.fn(async (input) => ({
    ...buildJob(input.kind, 'completed'),
    snapshotId: input.snapshotId,
    detail: input.detail,
  }));
  const openExternal = vi.fn(async () => undefined);
  const openPath = vi.fn(async () => undefined);
  const bridge = {
    getDesktopPreferences: vi.fn(async () => ({
      verbosityMode: 'normal' as const,
      workspaceRoot: 'C:/archive-workspace',
    })),
    setVerbosityMode: vi.fn(async (verbosityMode) => ({
      verbosityMode,
      workspaceRoot: 'C:/archive-workspace',
    })),
    getWorkspaceState: vi.fn(async () => ({
      version: 1 as const,
      workspaceRoot: 'C:/archive-workspace',
      activeProfileId: 'alpha',
      profiles: [
        {
          profileId: 'alpha',
          label: 'Primary account',
          userHandle: 'Prekzursil',
          provenance: {
            type: 'login' as const,
          },
          sessionCookiesPath: '.local/gui/profiles/alpha/session-cookies.json',
          createdAt: '2026-03-10T12:00:00.000Z',
          updatedAt: '2026-03-10T12:00:00.000Z',
        },
      ],
      notifications: {
        desktopBanners: true,
        windowsToast: true,
      },
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
    })),
    selectWorkspace: vi.fn(async () => ({
      version: 1 as const,
      workspaceRoot: 'C:/archive-workspace',
      activeProfileId: undefined,
      profiles: [],
      notifications: {
        desktopBanners: true,
        windowsToast: true,
      },
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
    })),
    loginProfile: vi.fn(async () => ({
      profile: {
        profileId: 'alpha',
        label: 'Primary account',
        userHandle: 'Prekzursil',
        provenance: {
          type: 'login' as const,
        },
        sessionCookiesPath: '.local/gui/profiles/alpha/session-cookies.json',
        createdAt: '2026-03-10T12:00:00.000Z',
        updatedAt: '2026-03-10T12:00:00.000Z',
      },
      workspaceState: {
        version: 1 as const,
        workspaceRoot: 'C:/archive-workspace',
        activeProfileId: 'alpha',
        profiles: [],
        notifications: {
          desktopBanners: true,
          windowsToast: true,
        },
        createdAt: '2026-03-10T12:00:00.000Z',
        updatedAt: '2026-03-10T12:00:00.000Z',
      },
      job: buildJob('auth-login', 'completed'),
    })),
    importBrowserProfile: vi.fn(async () => ({
      profile: {
        profileId: 'edge-default',
        label: 'Edge session',
        userHandle: 'Prekzursil',
        provenance: {
          type: 'browser-import' as const,
          browser: 'edge' as const,
        },
        sessionCookiesPath: '.local/gui/profiles/edge-default/session-cookies.json',
        createdAt: '2026-03-10T12:00:00.000Z',
        updatedAt: '2026-03-10T12:00:00.000Z',
      },
      workspaceState: {
        version: 1 as const,
        workspaceRoot: 'C:/archive-workspace',
        activeProfileId: 'edge-default',
        profiles: [],
        notifications: {
          desktopBanners: true,
          windowsToast: true,
        },
        createdAt: '2026-03-10T12:00:00.000Z',
        updatedAt: '2026-03-10T12:00:00.000Z',
      },
      job: buildJob('auth-import-browser', 'completed'),
    })),
    createProfile: vi.fn(async () => ({
      profileId: 'alpha',
      label: 'Primary account',
      userHandle: 'Prekzursil',
      provenance: {
        type: 'login' as const,
      },
      sessionCookiesPath: '.local/gui/profiles/alpha/session-cookies.json',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
    })),
    activateProfile: vi.fn(async () => ({
      version: 1 as const,
      workspaceRoot: 'C:/archive-workspace',
      activeProfileId: 'alpha',
      profiles: [],
      notifications: {
        desktopBanners: true,
        windowsToast: true,
      },
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
    })),
    deleteProfile: vi.fn(async () => ({
      version: 1 as const,
      workspaceRoot: 'C:/archive-workspace',
      profiles: [],
      notifications: {
        desktopBanners: true,
        windowsToast: true,
      },
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
    })),
    getArchiveExplorerSummary: vi.fn(async () => ({
      snapshotId: 'acceptance-20260310b',
      normalizedRoot: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized',
      mirrorRoot: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/mirror',
      mirrorServeCommand: 'npm run cli -- serve --snapshot acceptance-20260310b --port 4173',
      mirrorUrl: 'http://127.0.0.1:4173/',
      datasets: [
        {
          dataset: 'problems' as const,
          label: 'Problems',
          count: 1,
          directoryPath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/problems',
          description: 'Structured PBInfo problem records with sections, examples, constraints, and official-source metadata.',
        },
        {
          dataset: 'evaluations' as const,
          label: 'Evaluations',
          count: 0,
          directoryPath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/evaluations',
          description: 'Submission and evaluation records with score, verdict, tests, and compile logs when archived.',
        },
        {
          dataset: 'tests' as const,
          label: 'Tests',
          count: 1,
          directoryPath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/tests',
          description: 'Unified per-problem test dataset combining statement examples, visible tests, and evaluation-observed tests.',
        },
        {
          dataset: 'rankings' as const,
          label: 'Rankings',
          count: 1,
          directoryPath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/rankings',
          description: 'Canonical best-user and best-official language rankings derived from normalized evaluation sources.',
        },
        {
          dataset: 'mirror-routes' as const,
          label: 'Mirror Routes',
          count: 1,
          directoryPath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/routes',
          description: 'Route records that drive local mirror replay and link archived entities back into the offline viewer.',
        },
      ],
    })),
    listArchiveExplorerRecords: vi.fn(async (input) => {
      switch (input.dataset) {
        case 'problems':
          return {
            snapshotId: 'acceptance-20260310b',
            dataset: 'problems' as const,
            totalCount: 1,
            offset: 0,
            limit: 24,
            items: [
              {
                dataset: 'problems' as const,
                recordId: '3171',
                title: '#3171 waterreserve',
                subtitle: '/probleme/3171/problem-3171',
                description: '1 ≤ n ≤ 1.000.000',
                filePath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/problems/problem-3171.json',
                mirrorRoute: '/probleme/3171/problem-3171',
              },
            ],
          };
        case 'rankings':
          return {
            snapshotId: 'acceptance-20260310b',
            dataset: 'rankings' as const,
            totalCount: 1,
            offset: 0,
            limit: 24,
            items: [
              {
                dataset: 'rankings' as const,
                recordId: '3716',
                title: 'Problem #3716',
                subtitle: 'Best user languages: c, cpp, py3',
                description: 'Best user overall evaluation: 63332367',
                filePath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/rankings/best-submissions.json',
              },
            ],
          };
        default:
          return {
            snapshotId: 'acceptance-20260310b',
            dataset: input.dataset,
            totalCount: 0,
            offset: 0,
            limit: 24,
            items: [],
          };
      }
    }),
    getArchiveExplorerRecord: vi.fn(async () => ({
      snapshotId: 'acceptance-20260310b',
      dataset: 'problems' as const,
      recordId: '3171',
      title: '#3171 waterreserve',
      subtitle: '/probleme/3171/problem-3171',
      filePath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/problems/problem-3171.json',
      mirrorRoute: '/probleme/3171/problem-3171',
      payload: {
        id: 3171,
        name: 'waterreserve',
      },
    })),
    getCoverageSummary: vi.fn(async () => ({
      snapshotId: 'acceptance-20260310b',
      coverageRoot: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/problem-coverage',
      normalizedRoot: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized',
      mirrorRoot: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/mirror',
      mirrorServeCommand: 'npm run cli -- serve --snapshot acceptance-20260310b --port 4173',
      mirrorUrl: 'http://127.0.0.1:4173/',
      totalProblems: 2582,
      solvedByMeCount: 7,
      completeProblemCount: 3,
      incompleteSolvedProblemCount: 4,
      missingOfficialSourceCaptureCount: 1,
      officialSourceUnavailableUpstreamCount: 12,
      missingTestsCaptureCount: 2,
      testsUnavailableUpstreamCount: 8,
      statementArchivedCount: 2582,
      solutionFragmentArchivedCount: 2582,
      testsFragmentArchivedCount: 2582,
      problemsWithExamples: 1802,
      problemsWithVisibleTestsCaptured: 0,
      problemsWithEvaluationObservedTests: 1,
      problemsWithEffectiveTests: 0,
      problemsWithArchivedSources: 0,
      problemsWithOfficialSourceArchived: 0,
      problemsWithUserSourceArchived: 0,
      editorialVisibleCount: 832,
      rankingPresentCount: 7,
      newSinceBaselineCount: 0,
      unsolvedProblemCount: 3,
      missingOfficialSourceCount: 13,
      solvedByMeMissingUserSourceCount: 1,
    })),
    listCoverageRecords: vi.fn(async (input) => {
      const filtered = coverageRecords.filter((record) => {
        if (input.solved === 'solved' && !record.solvedByMe) {
          return false;
        }
        if (input.solved === 'unsolved' && record.solvedByMe) {
          return false;
        }
        if (
          input.archiveCompletenessStatus
          && input.archiveCompletenessStatus !== 'all'
          && record.archiveCompletenessStatus !== input.archiveCompletenessStatus
        ) {
          return false;
        }
        if (
          input.testsCoverageStatus
          && input.testsCoverageStatus !== 'all'
          && record.testsCoverageStatus !== input.testsCoverageStatus
        ) {
          return false;
        }
        if (input.query) {
          const haystack = `${record.problemId} ${record.slug} ${record.name} ${record.tags.join(' ')}`.toLowerCase();
          if (!haystack.includes(input.query.toLowerCase())) {
            return false;
          }
        }
        return true;
      });
      return {
        snapshotId: 'acceptance-20260310b',
        totalCount: filtered.length,
        offset: 0,
        limit: 100,
        items: filtered,
      };
    }),
    getCoverageRecord: vi.fn(async () => ({
      snapshotId: 'acceptance-20260310b',
      coverageFilePath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/problem-coverage/problem-3716.json',
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
        officialSourceArchived: false,
        officialSourceCount: 0,
        officialSourceLanguages: [],
        officialSourceStatus: 'not-captured-yet' as const,
        userSourceArchived: false,
        userSourceCount: 0,
        userSourceLanguages: [],
        requiredTrustworthyUserSourceLanguages: ['c'],
        trustworthyUserSourceLanguages: [],
        bestTrustworthyUserPerLanguage: {},
        missingTrustworthyUserSourceLanguages: ['c'],
        archiveCompletenessStatus: 'missing-user-source' as const,
        editorialAvailability: 'visible' as const,
        testsAvailable: true,
        unsolvedByConfiguredHandle: false,
        officialSourceBlocked: true,
        officialSourceBlockedReason: 'official-source-not-captured',
        notArchivedYet: false,
        newSinceBaseline: false,
        notes: [
          'Tests fragment archived, no visible test cases parsed.',
          'Source list available upstream, no archived source code yet.',
        ],
        canonicalUrl: 'https://www.pbinfo.ro/probleme/3716/crossword',
        sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/3716/crossword',
        statementArchived: true,
        solutionFragmentArchived: true,
        hasAnyArchivedSource: false,
        evaluationIds: [63332367],
        bestUserOverallEvaluationId: 63332367,
      },
      rawRecordLinks: {
        coverageFilePath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/problem-coverage/problem-3716.json',
        problemFilePath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/problems/problem-3716.json',
        rankingFilePath: 'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/rankings/problems/problem-3716.json',
        evaluationFilePaths: [
          'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/evaluations/evaluation-63332367.json',
        ],
        officialSourceFilePaths: [],
        userSourceFilePaths: [],
      },
    })),
    getCrawlStatus: vi.fn(async () => ({
      snapshotId: 'acceptance-20260310b',
      queuePath: '.local/crawl-queues/acceptance-20260310b.sqlite',
      status: 'completed' as const,
      pending: 42,
      completed: 120,
      inProgress: 0,
      publishEligible: true,
      recentFailures: [],
    })),
    listJobs: vi.fn(async () => [
      {
        jobId: 'crawl-job-1',
        kind: 'crawl' as const,
        status: 'completed' as const,
        snapshotId: 'acceptance-20260310b',
        detail: {
          mirrorPreviewUrl: 'http://127.0.0.1:43111',
        },
        logPath: '.local/gui/logs/crawl-job-1.jsonl',
        resumable: false,
        latestCounters: {
          pending: 42,
          completed: 12,
          inProgress: 1,
        },
        latestEvent: {
          timestamp: '2026-03-10T12:05:00.000Z',
          level: 'info' as const,
          stage: 'crawl',
          message: 'Crawl snapshot acceptance-20260310b paused after chunk',
        },
        createdAt: '2026-03-10T12:00:00.000Z',
        updatedAt: '2026-03-10T12:05:00.000Z',
      },
      {
        jobId: 'crawl-job-2',
        kind: 'crawl' as const,
        status: 'paused' as const,
        snapshotId: '20260310T122126Z',
        logPath: '.local/gui/logs/crawl-job-2.jsonl',
        resumable: true,
        latestCounters: {
          pending: 500_000,
          completed: 50_000,
          inProgress: 1,
        },
        latestEvent: {
          timestamp: '2026-03-10T12:06:00.000Z',
          level: 'info' as const,
          stage: 'crawl',
          message: 'Crawl snapshot 20260310T122126Z paused after chunk',
        },
        createdAt: '2026-03-10T12:01:00.000Z',
        updatedAt: '2026-03-10T12:06:00.000Z',
      },
      {
        jobId: 'mirror-preview-1',
        kind: 'mirror-serve' as const,
        status: 'running' as const,
        snapshotId: 'acceptance-20260310b',
        detail: {
          mirrorPreviewUrl: 'http://127.0.0.1:43111',
        },
        logPath: '.local/gui/logs/mirror-preview-1.jsonl',
        resumable: false,
        createdAt: '2026-03-10T12:00:00.000Z',
        updatedAt: '2026-03-10T12:05:00.000Z',
      },
    ]),
    listJobEvents: vi.fn(async (jobId: string) =>
      jobId === 'crawl-job-2'
        ? [
            {
              timestamp: '2026-03-10T12:06:00.000Z',
              level: 'info' as const,
              stage: 'crawl',
              message: 'Crawl snapshot 20260310T122126Z paused after chunk',
              counters: {
                pending: 500_000,
                completed: 50_000,
                inProgress: 1,
              },
              detail: {
                processed: 25,
              },
            },
            {
              timestamp: '2026-03-10T12:00:00.000Z',
              level: 'info' as const,
              stage: 'crawl',
              message: 'Crawl snapshot 20260310T122126Z paused after chunk',
              counters: {
                pending: 500_100,
                completed: 49_880,
                inProgress: 0,
              },
              detail: {
                processed: 30,
              },
            },
          ]
        : [
            {
              timestamp: '2026-03-10T12:05:00.000Z',
              level: 'info' as const,
              stage: 'crawl',
              message: 'Crawl snapshot acceptance-20260310b paused after chunk',
              counters: {
                pending: 42,
                completed: 120,
                inProgress: 0,
              },
              detail: {
                processed: 25,
              },
            },
            {
              timestamp: '2026-03-10T12:00:00.000Z',
              level: 'info' as const,
              stage: 'crawl',
              message: 'Crawl snapshot acceptance-20260310b paused after chunk',
              counters: {
                pending: 72,
                completed: 90,
                inProgress: 0,
              },
              detail: {
                processed: 30,
              },
            },
            {
              timestamp: '2026-03-10T12:04:00.000Z',
              level: 'debug' as const,
              stage: 'crawl-debug',
              message: 'Debug snapshot trace',
              detail: {
                sample: 'raw-only',
              },
            },
          ]),
    startJob,
    pauseJob: vi.fn(async () => buildJob('crawl', 'paused')),
    resumeJob: vi.fn(async () => buildJob('crawl', 'paused')),
    startMirrorPreview: vi.fn(async () => ({
      job: {
        ...buildJob('mirror-serve', 'running'),
        detail: {
          mirrorPreviewUrl: 'http://127.0.0.1:43111',
        },
      },
      baseUrl: 'http://127.0.0.1:43111',
    })),
    stopMirrorPreview: vi.fn(async () => buildJob('mirror-serve', 'completed')),
    openPath,
    openExternal,
  } as unknown as DesktopBridge;

  return {
    startJob,
    openPath,
    openExternal,
    bridge,
  };
}

function buildJob(
  kind:
    | 'crawl'
    | 'normalize'
    | 'rank'
    | 'mirror-build'
    | 'snapshot-finalize'
    | 'auth-login'
    | 'auth-import-browser'
    | 'mirror-serve',
  status: 'paused' | 'completed' | 'running',
) {
  return {
    jobId: `${kind}-job`,
    kind,
    status,
    snapshotId: 'acceptance-20260310b',
    logPath: `.local/gui/logs/${kind}-job.jsonl`,
    resumable: kind === 'crawl',
    createdAt: '2026-03-10T12:00:00.000Z',
    updatedAt: '2026-03-10T12:05:00.000Z',
  } as const;
}
