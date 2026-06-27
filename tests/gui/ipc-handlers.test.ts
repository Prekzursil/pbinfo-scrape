import { describe, expect, test, vi } from 'vitest';

import { createDesktopIpcRegistry } from '../../src/gui/main/ipc.js';

describe('desktop IPC registry', () => {
  test('validates and forwards job-start requests to the desktop controller', async () => {
    const startJob = vi.fn(async (payload) => ({
      kind: payload.kind,
      snapshotId: payload.snapshotId,
    }));
    const registry = createDesktopIpcRegistry({
      startJob,
      resumeJob: vi.fn(),
      pauseJob: vi.fn(),
      startMirrorPreview: vi.fn(),
      stopMirrorPreview: vi.fn(),
    });

    const result = await registry['desktop:jobs:start']({
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
    });

    expect(startJob).toHaveBeenCalledWith({
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
    });
    expect(result).toEqual({
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
    });
  });

  test('rejects invalid job-start payloads before they hit the controller', async () => {
    const registry = createDesktopIpcRegistry({
      startJob: vi.fn(),
      resumeJob: vi.fn(),
      pauseJob: vi.fn(),
      startMirrorPreview: vi.fn(),
      stopMirrorPreview: vi.fn(),
    });

    await expect(
      registry['desktop:jobs:start']({
        kind: 'publish',
      }),
    ).rejects.toThrow(/kind/i);
  });

  test('forwards pause and resume to the controller, parsing the maxIterations option', async () => {
    const pauseJob = vi.fn(async (jobId) => ({ jobId, status: 'paused' }));
    const resumeJob = vi.fn(async (jobId, options) => ({ jobId, options }));
    const registry = createDesktopIpcRegistry({
      startJob: vi.fn(),
      resumeJob,
      pauseJob,
      startMirrorPreview: vi.fn(),
      stopMirrorPreview: vi.fn(),
    });

    await registry['desktop:jobs:pause']({ jobId: 'job-1' });
    expect(pauseJob).toHaveBeenCalledWith('job-1');

    await registry['desktop:jobs:resume']({ jobId: 'job-2', maxIterations: 5 });
    expect(resumeJob).toHaveBeenCalledWith('job-2', { maxIterations: 5 });
  });

  test('starts and stops mirror previews, rejecting a start without a snapshot id', async () => {
    const startMirrorPreview = vi.fn(async (snapshotId, options) => ({ snapshotId, options }));
    const stopMirrorPreview = vi.fn(async (jobId) => ({ jobId }));
    const registry = createDesktopIpcRegistry({
      startJob: vi.fn(),
      resumeJob: vi.fn(),
      pauseJob: vi.fn(),
      startMirrorPreview,
      stopMirrorPreview,
    });

    await registry['desktop:mirror:start-preview']({ snapshotId: 'snap-1', port: 4321 });
    expect(startMirrorPreview).toHaveBeenCalledWith('snap-1', { port: 4321 });

    await registry['desktop:mirror:stop-preview']({ jobId: 'job-9' });
    expect(stopMirrorPreview).toHaveBeenCalledWith('job-9');

    await expect(
      registry['desktop:mirror:start-preview']({ port: 1 }),
    ).rejects.toThrow('snapshotId is required.');
  });

  test('rejects pause and stop requests that omit the job id', async () => {
    const registry = createDesktopIpcRegistry({
      startJob: vi.fn(),
      resumeJob: vi.fn(),
      pauseJob: vi.fn(),
      startMirrorPreview: vi.fn(),
      stopMirrorPreview: vi.fn(),
    });

    await expect(registry['desktop:jobs:pause']({})).rejects.toThrow('jobId is required.');
    await expect(registry['desktop:mirror:stop-preview']({})).rejects.toThrow('jobId is required.');
  });
});
