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
      {
        profileId: 'beta',
        label: 'Secondary',
        userHandle: 'Other',
        provenance: { type: 'browser-import', browser: 'edge' },
        sessionCookiesPath: '.local/beta.json',
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ],
    notifications: { desktopBanners: true, windowsToast: true },
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z',
  };
}

function baseRecord() {
  return {
    snapshotId: 'snap-1',
    totalCount: 0,
    offset: 0,
    limit: 24,
    items: [],
  };
}

function makeBridge(): DesktopBridge {
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
    getDesktopPreferences: vi.fn(async () => ({
      verbosityMode: 'normal' as const,
      workspaceRoot: 'C:/ws',
    })),
    setVerbosityMode: vi.fn(async (mode) => ({
      verbosityMode: mode,
      workspaceRoot: 'C:/ws',
    })),
    getWorkspaceState: vi.fn(async () => workspace()),
    selectWorkspace: vi.fn(async () => workspace()),
    loginProfile: vi.fn(async () => ({
      profile: workspace().profiles[0],
      workspaceState: workspace(),
      job: job({ kind: 'auth-login', status: 'completed' }),
    })),
    importBrowserProfile: vi.fn(async () => ({
      profile: workspace().profiles[0],
      workspaceState: workspace(),
      job: job({ kind: 'auth-import-browser', status: 'completed' }),
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
      datasets: [
        {
          dataset: 'problems' as const,
          label: 'Problems',
          count: 1,
          directoryPath: 'C:/ws/problems',
          description: 'desc',
        },
        {
          dataset: 'rankings' as const,
          label: 'Rankings',
          count: 0,
          directoryPath: 'C:/ws/rankings',
          description: 'desc',
        },
      ],
    })),
    listArchiveExplorerRecords: vi.fn(async () => ({
      ...baseRecord(),
      dataset: 'problems' as const,
    })),
    getArchiveExplorerRecord: vi.fn(async () => ({
      snapshotId: 'snap-1',
      dataset: 'problems' as const,
      recordId: '100',
      title: '#100',
      subtitle: '/x',
      filePath: 'C:/ws/x.json',
      mirrorRoute: '/probleme/100/sample',
      payload: { id: 100 },
    })),
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
    listCoverageRecords: vi.fn(async () => baseRecord()),
    getCoverageRecord: vi.fn(async () => undefined as never),
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
    listJobs: vi.fn(async () => []),
    listJobEvents: vi.fn(async () => []),
    startJob: vi.fn(async (input) =>
      job({
        kind: input.kind,
        snapshotId: input.snapshotId ?? 'snap-1',
        status: 'completed',
      }),
    ),
    pauseJob: vi.fn(async () => job({ status: 'paused' })),
    resumeJob: vi.fn(async () => job({ status: 'paused', snapshotId: 'snap-1' })),
    startMirrorPreview: vi.fn(async () => ({
      job: job({ kind: 'mirror-serve', status: 'running' }),
      baseUrl: 'http://127.0.0.1:43111',
    })),
    stopMirrorPreview: vi.fn(async () => job({ kind: 'mirror-serve', status: 'completed' })),
    openPath: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
  } as unknown as DesktopBridge;
}

describe('App snapshot job actions', () => {
  test('Normalize snapshot button triggers startJob with normalize kind', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);
    fireEvent.click(await screen.findByRole('button', { name: /Normalize snapshot/i }));
    await waitFor(() =>
      expect(bridge.startJob).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'normalize',
        }),
      ),
    );
  });

  test('Rank sources button triggers startJob with rank kind', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);
    fireEvent.click(await screen.findByRole('button', { name: /Rank sources/i }));
    await waitFor(() =>
      expect(bridge.startJob).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'rank',
        }),
      ),
    );
  });

  test('Build mirror button triggers startJob with mirror-build kind', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);
    fireEvent.click(await screen.findByRole('button', { name: /Build mirror/i }));
    await waitFor(() =>
      expect(bridge.startJob).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'mirror-build',
        }),
      ),
    );
  });

  test('Finalize snapshot button triggers startJob with snapshot-finalize kind', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);
    fireEvent.click(await screen.findByRole('button', { name: /Finalize snapshot/i }));
    await waitFor(() =>
      expect(bridge.startJob).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'snapshot-finalize',
        }),
      ),
    );
  });

  test('Start mirror preview triggers bridge.startMirrorPreview', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);
    fireEvent.click(await screen.findByRole('button', { name: /Start preview/i }));
    await waitFor(() => expect(bridge.startMirrorPreview).toHaveBeenCalled());
  });

  test('Stop preview button is rendered alongside Start preview', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);
    expect(await screen.findByRole('button', { name: /Start preview/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Stop preview/i })).toBeInTheDocument();
  });

  test('clicking Stop preview triggers bridge.stopMirrorPreview (lines 646-654 of app.tsx)', async () => {
    // To enable the Stop preview button, the bridge must return a mirror-serve job with
    // detail.mirrorPreviewUrl set so that previewJob is non-null.
    const mirrorServeJob: GuiJobRecord = {
      jobId: 'preview-job-99',
      kind: 'mirror-serve' as const,
      status: 'running' as const,
      snapshotId: 'snap-1',
      logPath: '.local/mirror.jsonl',
      resumable: false,
      detail: { mirrorPreviewUrl: 'http://127.0.0.1:4173/' },
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:01:00.000Z',
    };

    const bridge: DesktopBridge = {
      ...makeBridge(),
      listJobs: vi.fn(async () => [mirrorServeJob]),
      stopMirrorPreview: vi.fn(async () => ({
        jobId: 'preview-job-99',
        kind: 'mirror-serve' as const,
        status: 'completed' as const,
        snapshotId: 'snap-1',
        logPath: '.local/mirror.jsonl',
        resumable: false,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:02:00.000Z',
      })),
    } as unknown as DesktopBridge;

    render(<App desktop={bridge} />);

    // Wait for bridge.listJobs to be called and the previewJobId to be set
    await waitFor(() => expect(bridge.listJobs).toHaveBeenCalled());

    const stopButton = await screen.findByRole('button', { name: /Stop preview/i });
    expect(stopButton).not.toBeDisabled();
    fireEvent.click(stopButton);

    await waitFor(() =>
      expect(bridge.stopMirrorPreview).toHaveBeenCalledWith('preview-job-99'),
    );
  });

  test('Refresh button triggers refresh which calls getWorkspaceState again', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);
    await waitFor(() => expect(bridge.getWorkspaceState).toHaveBeenCalled());
    const before = (bridge.getWorkspaceState as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: /^Refresh/i }));
    await waitFor(() => {
      const after = (bridge.getWorkspaceState as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(after).toBeGreaterThan(before);
    });
  });
});

describe('App import browser profile action (lines 538-546 of app.tsx)', () => {
  test('submitting the browser import form triggers bridge.importBrowserProfile', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Setup' }));

    // Submit the "Browser import" form to trigger onImportBrowserProfile
    const importButton = await screen.findByRole('button', { name: /Import browser cookies/i });
    fireEvent.click(importButton);

    await waitFor(() => expect(bridge.importBrowserProfile).toHaveBeenCalled());
  });
});

describe('App login profile action (lines 527-535 of app.tsx)', () => {
  test('submitting the credential login form triggers bridge.loginProfile', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Setup' }));

    // Submit the "Credential login" form to trigger onLoginProfile
    const signInButton = await screen.findByRole('button', { name: /Sign in/i });
    fireEvent.click(signInButton);

    await waitFor(() => expect(bridge.loginProfile).toHaveBeenCalled());
  });
});

describe('App profile management actions', () => {
  test('Activate profile button triggers bridge.activateProfile', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Setup' }));
    // Activate is rendered for non-active profiles only - beta is non-active.
    const activates = await screen.findAllByRole('button', { name: /^Activate$/i });
    fireEvent.click(activates[0]!);
    await waitFor(() => expect(bridge.activateProfile).toHaveBeenCalled());
  });

  test('Delete profile button triggers bridge.deleteProfile', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Setup' }));
    const deleteButtons = await screen.findAllByRole('button', { name: /Delete/i });
    fireEvent.click(deleteButtons[0]!);
    await waitFor(() => expect(bridge.deleteProfile).toHaveBeenCalled());
  });
});

describe('App pause crawl action (lines 598-599 of app.tsx)', () => {
  test('clicking "Pause after current chunk" triggers bridge.pauseJob with the active crawl jobId', async () => {
    const bridge = makeBridge();
    // Provide a running crawl job so the Pause button renders
    (bridge.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        jobId: 'running-crawl',
        kind: 'crawl',
        status: 'running',
        snapshotId: 'snap-1',
        logPath: '.local/x.jsonl',
        resumable: false,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:01:00.000Z',
      },
    ]);
    render(<App desktop={bridge} />);
    const pauseButton = await screen.findByRole('button', { name: /Pause/i });
    fireEvent.click(pauseButton);
    await waitFor(() =>
      expect(bridge.pauseJob).toHaveBeenCalledWith('running-crawl'),
    );
  });
});

describe('App resume crawl action', () => {
  test('Resume crawl button triggers bridge.resumeJob with the active crawl jobId', async () => {
    const bridge = makeBridge();
    (bridge.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        jobId: 'paused-crawl',
        kind: 'crawl',
        status: 'paused',
        snapshotId: 'snap-1',
        logPath: '.local/x.jsonl',
        resumable: true,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:01:00.000Z',
      },
    ]);
    render(<App desktop={bridge} />);
    const resume = await screen.findByRole('button', { name: /Resume crawl/i });
    fireEvent.click(resume);
    await waitFor(() =>
      expect(bridge.resumeJob).toHaveBeenCalledWith(
        'paused-crawl',
        expect.objectContaining({
          maxIterations: expect.any(Number),
        }),
      ),
    );
  });
});

describe('App data view interactions', () => {
  test('switching to Data view causes archive listing to be fetched', async () => {
    const bridge = makeBridge();
    render(<App desktop={bridge} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Data' }));
    await waitFor(() => expect(bridge.listArchiveExplorerRecords).toHaveBeenCalled());
  });
});
