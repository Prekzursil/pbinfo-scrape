import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createRunRefreshCoordinator } from '../../../src/gui/main/run-refresh-coordinator.js';

describe('run-refresh-coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('start returns a jobId and records state', async () => {
    const runPipeline = vi.fn(async () => ({
      archiveRoot: '/a',
      snapshotId: 'snap-new',
    }));
    const coord = createRunRefreshCoordinator({
      runPipeline,
      broadcast: vi.fn(),
      broadcastArchiveChanged: vi.fn(),
    });

    const { jobId, completion } = coord.start({});
    expect(jobId).toBeDefined();
    await completion;
  });

  test('second start while running returns the existing jobId (mutex)', async () => {
    let resolveFirst: (() => void) | undefined;
    const runPipeline = vi.fn(
      () =>
        new Promise<{ archiveRoot: string; snapshotId: string }>((resolve) => {
          resolveFirst = () =>
            resolve({ archiveRoot: '/a', snapshotId: 'snap-new' });
        }),
    );
    const coord = createRunRefreshCoordinator({
      runPipeline,
      broadcast: vi.fn(),
      broadcastArchiveChanged: vi.fn(),
    });

    const first = coord.start({});
    const second = coord.start({});
    expect(second.jobId).toBe(first.jobId);
    expect(runPipeline).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await first.completion;
  });

  test('completion emits archive:changed with cause: refresh-complete', async () => {
    const broadcastArchiveChanged = vi.fn();
    const runPipeline = vi.fn(async () => ({
      archiveRoot: '/a',
      snapshotId: 'snap-new',
    }));
    const coord = createRunRefreshCoordinator({
      runPipeline,
      broadcast: vi.fn(),
      broadcastArchiveChanged,
    });

    const { completion } = coord.start({});
    await completion;

    expect(broadcastArchiveChanged).toHaveBeenCalledWith({
      archiveRoot: '/a',
      snapshotId: 'snap-new',
      cause: 'refresh-complete',
    });
  });

  test('progress events emitted via onProgress bubble up through broadcast', async () => {
    const broadcast = vi.fn();
    let emittedProgress:
      | ((phase: 'crawl-list', processed: number) => void)
      | undefined;
    const runPipeline = vi.fn(
      async ({
        onProgress,
      }: {
        onProgress: (p: { phase: 'crawl-list'; processed: number }) => void;
      }) => {
        emittedProgress = (phase, processed) => onProgress({ phase, processed });
        return { archiveRoot: '/a', snapshotId: 'snap-new' };
      },
    );
    const coord = createRunRefreshCoordinator({
      runPipeline,
      broadcast,
      broadcastArchiveChanged: vi.fn(),
    });

    const { completion, jobId } = coord.start({});
    await Promise.resolve();
    emittedProgress?.('crawl-list', 42);
    await completion;

    const firstProgressCall = broadcast.mock.calls.find(
      (call) => (call[0] as { phase?: string }).phase === 'crawl-list',
    );
    expect(firstProgressCall).toBeDefined();
    expect((firstProgressCall?.[0] as { jobId: string }).jobId).toBe(jobId);
  });

  test('cancel aborts the pipeline and emits a cancelled finalize event', async () => {
    const broadcast = vi.fn();
    const runPipeline = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<{ archiveRoot: string; snapshotId: string }>((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('cancelled'));
          });
        }),
    );
    const coord = createRunRefreshCoordinator({
      runPipeline,
      broadcast,
      broadcastArchiveChanged: vi.fn(),
    });

    const { jobId, completion } = coord.start({});
    coord.cancel({ jobId });
    await completion;

    const lastCall = broadcast.mock.calls.at(-1);
    expect(lastCall?.[0]).toMatchObject({
      phase: 'finalize',
      message: 'cancelled',
    });
  });

  test('cancel for an unknown jobId is a no-op', () => {
    const coord = createRunRefreshCoordinator({
      runPipeline: vi.fn(async () => ({
        archiveRoot: '/a',
        snapshotId: 'snap-new',
      })),
      broadcast: vi.fn(),
      broadcastArchiveChanged: vi.fn(),
    });
    expect(coord.cancel({ jobId: 'does-not-exist' })).toEqual({
      cancelled: false,
    });
  });
});
