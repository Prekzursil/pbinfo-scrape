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
});
