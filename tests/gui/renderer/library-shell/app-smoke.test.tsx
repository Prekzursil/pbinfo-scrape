import '@testing-library/jest-dom/vitest';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { App } from '../../../../src/gui/renderer/app.js';
import type { DesktopBridge } from '../../../../src/gui/shared/bridge.js';

afterEach(() => {
  cleanup();
});

type Unsubscribe = () => void;

function createBridge(
  archive: Awaited<ReturnType<DesktopBridge['archive']['getState']>>,
): DesktopBridge {
  return {
    getDesktopPreferences: vi.fn(async () => ({ verbosityMode: 'normal' })),
    setVerbosityMode: vi.fn(),
    getWorkspaceState: vi.fn(async () => null),
    selectWorkspace: vi.fn(),
    loginProfile: vi.fn(),
    importBrowserProfile: vi.fn(),
    createProfile: vi.fn(),
    activateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    getArchiveExplorerSummary: vi.fn(),
    listArchiveExplorerRecords: vi.fn(),
    getArchiveExplorerRecord: vi.fn(),
    getCoverageSummary: vi.fn(),
    listCoverageRecords: vi.fn(),
    getCoverageRecord: vi.fn(),
    getCrawlStatus: vi.fn(async () => null),
    listJobs: vi.fn(async () => []),
    listJobEvents: vi.fn(async () => []),
    startJob: vi.fn(),
    pauseJob: vi.fn(),
    resumeJob: vi.fn(),
    startMirrorPreview: vi.fn(),
    stopMirrorPreview: vi.fn(),
    openPath: vi.fn(),
    openExternal: vi.fn(),
    archive: {
      getState: vi.fn(async () => archive),
      setManualOverride: vi.fn(),
      onChanged: vi.fn(() => (() => undefined) as Unsubscribe),
    },
    theme: {
      get: vi.fn(async () => ({ effective: 'light', preference: 'auto' })),
      set: vi.fn(),
      onChanged: vi.fn(() => (() => undefined) as Unsubscribe),
    },
    library: {
      listProblems: vi.fn(async () => ({
        totalCount: 0,
        rows: [],
        snapshotId: archive.snapshotId,
      })),
      listTags: vi.fn(async () => []),
      getDetail: vi.fn(),
    },
    shell: {
      openPath: vi.fn(),
      copyToClipboard: vi.fn(),
    },
    operator: {
      runFullRefresh: vi.fn(async () => ({ jobId: 'job-1' })),
      runFullRefreshCancel: vi.fn(async () => ({ cancelled: true })),
      onProgress: vi.fn(() => (() => undefined) as Unsubscribe),
      login: vi.fn(),
      openLiveSiteViewer: vi.fn(),
    },
  } as unknown as DesktopBridge;
}

describe('<App> library-shell smoke', () => {
  test('renders EmptyStateWelcome when archive is not found', async () => {
    const bridge = createBridge({
      found: false,
      probedPaths: ['/a', '/b', '/c'],
    });
    render(<App desktop={bridge} />);
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /welcome to problem archive crawler/i,
        }),
      ).toBeInTheDocument();
    });
  });

  test('renders LibraryShell when archive is found', async () => {
    const bridge = createBridge({
      found: true,
      archiveRoot: '/a/archive',
      snapshotId: 'snap-1',
      probedPaths: ['/a/archive'],
    });
    render(<App desktop={bridge} />);
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /problem archive crawler/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /operator/i }),
    ).toBeInTheDocument();
  });

  test('shows an archive-probed-path list on empty state', async () => {
    const bridge = createBridge({
      found: false,
      probedPaths: ['/p1/archive', '/p2/resources/archive', '/p3/archive'],
    });
    render(<App desktop={bridge} />);
    await waitFor(() => {
      expect(screen.getByText('/p1/archive')).toBeInTheDocument();
    });
    expect(screen.getByText('/p2/resources/archive')).toBeInTheDocument();
    expect(screen.getByText('/p3/archive')).toBeInTheDocument();
  });
});
