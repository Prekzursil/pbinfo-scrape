import { describe, expect, test, vi } from 'vitest';

import { buildDesktopBridge, createDesktopBridge } from '../../src/gui/preload/api.js';

function recordingAdapter() {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  return {
    calls,
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload });
      return { channel, payload };
    }),
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('createDesktopBridge flat surface', () => {
  test('forwards every flat bridge method to its invoke channel', async () => {
    const adapter = recordingAdapter();
    const bridge = createDesktopBridge(adapter);

    await bridge.getDesktopPreferences();
    await bridge.setVerbosityMode('verbose');
    await bridge.getWorkspaceState();
    await bridge.selectWorkspace('C:/ws');
    await bridge.loginProfile({ profileId: 'a' } as never);
    await bridge.importBrowserProfile({ profileId: 'a' } as never);
    await bridge.createProfile({ profileId: 'a' } as never);
    await bridge.activateProfile('a');
    await bridge.deleteProfile('a');
    await bridge.getArchiveExplorerSummary('snap');
    await bridge.getArchiveExplorerSummary();
    await bridge.listArchiveExplorerRecords({ dataset: 'problems' } as never);
    await bridge.getArchiveExplorerRecord({ dataset: 'problems', recordId: 'x' } as never);
    await bridge.getCoverageSummary('snap');
    await bridge.getCoverageSummary();
    await bridge.listCoverageRecords({} as never);
    await bridge.getCoverageRecord({ problemId: 1 } as never);
    await bridge.getCrawlStatus('snap');
    await bridge.getCrawlStatus();
    await bridge.listJobs();
    await bridge.listJobEvents('job', 10);
    await bridge.startJob({ kind: 'crawl' } as never);
    await bridge.pauseJob('job');
    await bridge.resumeJob('job', { maxIterations: 3 });
    await bridge.resumeJob('job');
    await bridge.startMirrorPreview('snap', 4173);
    await bridge.stopMirrorPreview('job');
    await bridge.openPath('C:/file');
    await bridge.openExternal('https://example.com/');

    const channels = adapter.calls.map((entry) => entry.channel);
    expect(channels).toContain('desktop:preferences:get');
    expect(channels).toContain('desktop:mirror:start-preview');
    expect(channels).toContain('desktop:path:open');
    // snapshot-less summary/status pass an empty object, not the snapshot id.
    expect(adapter.calls).toContainEqual({ channel: 'desktop:archive:summary', payload: {} });
    expect(adapter.calls).toContainEqual({
      channel: 'desktop:archive:summary',
      payload: { snapshotId: 'snap' },
    });
    expect(adapter.calls).toContainEqual({
      channel: 'desktop:jobs:resume',
      payload: { jobId: 'job', maxIterations: 3 },
    });
    expect(adapter.calls).toContainEqual({ channel: 'desktop:jobs:resume', payload: { jobId: 'job' } });
  });

  test('event subscriptions tolerate adapters without an unsubscribe function or off handler', () => {
    const bridge = buildDesktopBridge({
      invoke: vi.fn(),
      // on returns void (no unsubscribe function) and there is no off handler.
      on: vi.fn(() => undefined),
    });
    const listener = vi.fn();

    const unsubscribe = bridge.events.subscribe('jobs:updated', listener);
    // Should not throw even though there is no unsubscribe function or off().
    expect(() => unsubscribe()).not.toThrow();
  });

  test('event subscription delivers the trailing argument as the payload', () => {
    let captured: ((...args: unknown[]) => void) | undefined;
    const bridge = buildDesktopBridge({
      invoke: vi.fn(),
      on: vi.fn((_channel: string, handler: (...args: unknown[]) => void) => {
        captured = handler;
        return vi.fn();
      }),
      off: vi.fn(),
    });
    const listener = vi.fn();

    bridge.events.subscribe('jobs:updated', listener);
    captured?.({}, { jobId: 'j1' });
    expect(listener).toHaveBeenCalledWith({ jobId: 'j1' });
  });
});
