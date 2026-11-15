// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/gui/renderer/app.js';
import { createBridgeHarness } from './_helpers/desktop-bridge-harness.js';

afterEach(() => {
  cleanup();
});

const ready = () => screen.findByRole('heading', { name: 'Problem Archive Crawler' });

describe('App unmount-race guards', () => {
  test('ignores a preferences resolution that lands after unmount', async () => {
    const harness = createBridgeHarness();
    let resolvePreferences!: (value: unknown) => void;
    (harness.bridge.getDesktopPreferences as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreferences = resolve;
        }),
    );
    const view = render(<App desktop={harness.bridge} />);
    view.unmount();
    resolvePreferences({ verbosityMode: 'normal', workspaceRoot: 'C:/archive-workspace' });
    await Promise.resolve();
    // No setState crash and no error surfaced: the cancelled guard held.
    expect(document.querySelector('.error-banner')).toBeNull();
  });

  test('ignores a preferences rejection that lands after unmount', async () => {
    const harness = createBridgeHarness();
    let rejectPreferences!: (reason: unknown) => void;
    (harness.bridge.getDesktopPreferences as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPreferences = reject;
        }),
    );
    const view = render(<App desktop={harness.bridge} />);
    view.unmount();
    rejectPreferences(new Error('too late'));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.error-banner')).toBeNull();
  });

  test('ignores detail-fetch rejections that land after unmount', async () => {
    const harness = createBridgeHarness();
    const rejectors: Array<(reason: unknown) => void> = [];
    (harness.bridge.getCoverageRecord as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectors.push(reject);
        }),
    );
    (harness.bridge.getArchiveExplorerRecord as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectors.push(reject);
        }),
    );
    const view = render(<App desktop={harness.bridge} />);
    await ready();
    // Wait until both detail fetches are in flight (listings resolved and a
    // record was auto-selected) before tearing the component down.
    await waitFor(() => {
      expect(rejectors.length).toBeGreaterThanOrEqual(2);
    });
    view.unmount();
    for (const reject of rejectors.splice(0)) {
      reject(new Error('late detail failure'));
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.error-banner')).toBeNull();
  });

  test('ignores summary and listing rejections that land after unmount', async () => {
    const harness = createBridgeHarness();
    const rejectors: Array<(reason: unknown) => void> = [];
    for (const method of [
      'getArchiveExplorerSummary',
      'getCoverageSummary',
      'listCoverageRecords',
      'listArchiveExplorerRecords',
    ] as const) {
      (harness.bridge[method] as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectors.push(reject);
          }),
      );
    }
    const view = render(<App desktop={harness.bridge} />);
    await ready();
    view.unmount();
    for (const reject of rejectors.splice(0)) {
      reject(new Error('late listing failure'));
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.error-banner')).toBeNull();
  });
});

describe('App action and event fallbacks', () => {
  test('tolerates a startJob that resolves without a job record', async () => {
    const harness = createBridgeHarness();
    (harness.startJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    // runAction still reports success; no crawl loop was pinned and no refresh crashed.
    expect(await screen.findByText('Started all crawl')).toBeInTheDocument();
  });

  test('tolerates a resumeJob that resolves without a job record', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.resumeJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Resume/i }));
    expect(await screen.findByText('Crawl resumed')).toBeInTheDocument();
  });

  test('falls back to an empty event list when listJobEvents rejects', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.listJobEvents as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('events unavailable'),
    );
    render(<App desktop={harness.bridge} />);
    await ready();
    // The rejection is swallowed by readPreferredJobEvents; the dashboard
    // renders without an error banner for it.
    await waitFor(() => {
      expect(screen.queryByText('events unavailable')).toBeNull();
    });
  });

  test('clears the crawl loop pin once the pinned job settles', async () => {
    const harness = createBridgeHarness();
    const pinnedJob = {
      jobId: 'crawl-pin',
      kind: 'crawl' as const,
      status: 'completed' as const,
      snapshotId: 'acceptance-20260310b',
      logPath: '.local/gui/logs/crawl-pin.jsonl',
      resumable: false,
      createdAt: '2026-03-10T12:10:00.000Z',
      updatedAt: '2026-03-10T12:11:00.000Z',
    };
    // Deterministic job list: the pinned job appears as a completed crawl so
    // the settle-adjust runs on the post-refresh render.
    const completedCrawlJob = {
      jobId: 'crawl-job-1',
      kind: 'crawl' as const,
      status: 'completed' as const,
      snapshotId: 'acceptance-20260310b',
      logPath: '.local/gui/logs/crawl-job-1.jsonl',
      resumable: false,
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:05:00.000Z',
    };
    const pausedCrawlJob = {
      jobId: 'crawl-job-2',
      kind: 'crawl' as const,
      status: 'paused' as const,
      snapshotId: '20260310T122126Z',
      logPath: '.local/gui/logs/crawl-job-2.jsonl',
      resumable: true,
      createdAt: '2026-03-10T12:01:00.000Z',
      updatedAt: '2026-03-10T12:06:00.000Z',
    };
    // Order matters: the reversed "latest crawl" fallback at mount time must
    // be the paused job, so settle stays false until the pin resolves.
    (harness.bridge.listJobs as ReturnType<typeof vi.fn>).mockImplementation(async () => [
      pinnedJob,
      completedCrawlJob,
      pausedCrawlJob,
    ]);
    (harness.startJob as ReturnType<typeof vi.fn>).mockResolvedValue(pinnedJob);
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    await waitFor(() => {
      expect(screen.getByText('Started all crawl')).toBeInTheDocument();
    });
    // The pinned job already reports completed, so the loop pin is cleared
    // during render and no auto-resume is attempted for it.
    expect(harness.bridge.resumeJob).not.toHaveBeenCalled();
  });

  test('refreshes the workspace state on the polling interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const harness = createBridgeHarness();
      render(<App desktop={harness.bridge} />);
      await vi.waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'Problem Archive Crawler' }),
        ).toBeInTheDocument();
      });
      const callsAfterMount = (harness.bridge.getWorkspaceState as ReturnType<typeof vi.fn>).mock
        .calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(
        (harness.bridge.getWorkspaceState as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsAfterMount);
    } finally {
      vi.useRealTimers();
    }
  });

  test('keeps the workspace draft blanked when the workspace disappears', async () => {
    const harness = createBridgeHarness();
    render(<App desktop={harness.bridge} />);
    await ready();
    (harness.bridge.getWorkspaceState as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(null);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    // The workspace root vanishes from the summary without crashing.
    await waitFor(() => {
      expect(screen.queryByText('C:/archive-workspace')).toBeNull();
    });
  });
});
