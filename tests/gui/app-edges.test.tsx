import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/gui/renderer/app.js';
import { createBridgeHarness } from './_helpers/desktop-bridge-harness.js';

afterEach(() => {
  cleanup();
});

const ready = () => screen.findByRole('heading', { name: 'Problem Archive Crawler' });

describe('App edge and error paths', () => {
  test('surfaces detail-fetch failures from coverage and archive records', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.getCoverageRecord as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('coverage detail failed'));
    (harness.bridge.getArchiveExplorerRecord as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('archive detail failed'));
    render(<App desktop={harness.bridge} />);
    await ready();
    expect((await screen.findAllByText(/detail failed/)).length).toBeGreaterThanOrEqual(1);
  });

  test('surfaces a refresh failure when the job list cannot be read', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.listJobs as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('jobs unavailable'));
    render(<App desktop={harness.bridge} />);
    // The refresh effect throws before workspace state is set, so the shell stays on the loading view.
    expect(await screen.findByText(/Loading desktop state/)).toBeInTheDocument();
  });

  test('reports a non-Error action rejection through runAction', async () => {
    const harness = createBridgeHarness();
    (harness.startJob as ReturnType<typeof vi.fn>).mockRejectedValue('plain string failure');
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    expect(await screen.findByText('plain string failure')).toBeInTheDocument();
  });

  test('reports a verbosity persistence failure', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.setVerbosityMode as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('verbosity save failed'));
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Verbose' }));
    expect(await screen.findByText('verbosity save failed')).toBeInTheDocument();
  });

  test('falls back to the selected snapshot when started and resumed jobs omit one', async () => {
    const harness = createBridgeHarness();
    const noSnapshotJob = {
      jobId: 'crawl-x',
      kind: 'crawl' as const,
      status: 'completed' as const,
      logPath: '.local/gui/logs/crawl-x.jsonl',
      resumable: true,
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:05:00.000Z',
    };
    (harness.startJob as ReturnType<typeof vi.fn>).mockResolvedValue(noSnapshotJob);
    (harness.bridge.resumeJob as ReturnType<typeof vi.fn>).mockResolvedValue(noSnapshotJob);
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Resume crawl/ }));
    await waitFor(() => {
      expect((harness.bridge.resumeJob as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      expect((harness.startJob as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
  });

  test('reads preferred job events for finalize-only history across verbosity modes', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        jobId: 'finalize-1',
        kind: 'snapshot-finalize',
        status: 'completed',
        snapshotId: 'acceptance-20260310b',
        logPath: '.local/gui/logs/finalize-1.jsonl',
        resumable: false,
        createdAt: '2026-03-10T12:00:00.000Z',
        updatedAt: '2026-03-10T12:05:00.000Z',
      },
    ]);
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Verbose' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Raw' }));
    await waitFor(() => {
      expect(
        (harness.bridge.listJobEvents as ReturnType<typeof vi.fn>).mock.calls.some(
          (call) => call[0] === 'finalize-1',
        ),
      ).toBe(true);
    });
  });

  test('handles an empty archive dataset listing', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.listArchiveExplorerRecords as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshotId: 'acceptance-20260310b',
      dataset: 'problems',
      totalCount: 0,
      offset: 0,
      limit: 24,
      items: [],
    });
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('tab', { name: 'Data' }));
    expect(await screen.findByText(/No records are available/)).toBeInTheDocument();
  });

  test('stops the crawl loop when the active crawl job is not resumable', async () => {
    const harness = createBridgeHarness();
    const runningJob = {
      jobId: 'crawl-run',
      kind: 'crawl' as const,
      status: 'running' as const,
      snapshotId: 'acceptance-20260310b',
      logPath: '.local/gui/logs/crawl-run.jsonl',
      resumable: false,
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:05:00.000Z',
    };
    (harness.startJob as ReturnType<typeof vi.fn>).mockResolvedValue(runningJob);
    (harness.bridge.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([runningJob]);
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    await waitFor(() => {
      expect((harness.startJob as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
  });

  test('clears the crawl loop once the active job completes', async () => {
    const harness = createBridgeHarness();
    const doneJob = {
      jobId: 'crawl-done',
      kind: 'crawl' as const,
      status: 'completed' as const,
      snapshotId: 'acceptance-20260310b',
      logPath: '.local/gui/logs/crawl-done.jsonl',
      resumable: true,
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:05:00.000Z',
    };
    (harness.startJob as ReturnType<typeof vi.fn>).mockResolvedValue(doneJob);
    (harness.bridge.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([doneJob]);
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    await waitFor(() => {
      expect((harness.startJob as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
  });

  test('continues the auto-resume loop when the resumed job omits a snapshot id', async () => {
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
    (harness.bridge.resumeJob as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pausedJob,
      snapshotId: undefined,
    });
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    await waitFor(
      () => {
        expect((harness.bridge.resumeJob as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      },
      { timeout: 4000 },
    );
  });

  test('reads preferred job events from a mirror-build job when no crawl exists', async () => {
    const harness = createBridgeHarness();
    (harness.bridge.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        jobId: 'mirror-build-1',
        kind: 'mirror-build',
        status: 'completed',
        snapshotId: 'acceptance-20260310b',
        logPath: '.local/gui/logs/mirror-build-1.jsonl',
        resumable: false,
        createdAt: '2026-03-10T12:00:00.000Z',
        updatedAt: '2026-03-10T12:05:00.000Z',
      },
    ]);
    render(<App desktop={harness.bridge} />);
    await ready();
    await waitFor(() => {
      expect(
        (harness.bridge.listJobEvents as ReturnType<typeof vi.fn>).mock.calls.some(
          (call) => call[0] === 'mirror-build-1',
        ),
      ).toBe(true);
    });
  });

  test('surfaces a resume failure raised inside the auto-resume loop', async () => {
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
    (harness.bridge.resumeJob as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('loop resume failed'));
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    await waitFor(
      () => {
        expect(screen.getByText('loop resume failed')).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
  });
});
