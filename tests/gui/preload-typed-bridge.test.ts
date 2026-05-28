import { describe, expect, test, vi } from 'vitest';

import { createDesktopBridge } from '../../src/gui/preload/api.js';

function makeBridge() {
  const invoke = vi.fn(async (channel: string, payload?: unknown) => ({ channel, payload }));
  const on = vi.fn(() => () => undefined);
  const off = vi.fn();
  return { bridge: createDesktopBridge({ invoke, on, off }), invoke, on, off };
}

describe('typed desktop bridge', () => {
  test('forwards every method to its dedicated channel', async () => {
    const { bridge, invoke } = makeBridge();

    await bridge.getDesktopPreferences();
    await bridge.setVerbosityMode('raw');
    await bridge.getWorkspaceState();
    await bridge.selectWorkspace('C:/workspace');
    await bridge.loginProfile({
      profileId: 'p',
      label: 'l',
      username: 'u',
      password: 'pw',
    });
    await bridge.importBrowserProfile({
      profileId: 'p',
      label: 'l',
      browser: 'edge',
    });
    await bridge.createProfile({
      profileId: 'p',
      label: 'l',
      provenance: { type: 'cookie-import' },
      sessionCookies: [],
    });
    await bridge.activateProfile('p');
    await bridge.deleteProfile('p');
    await bridge.getArchiveExplorerSummary('snap');
    await bridge.getArchiveExplorerSummary();
    await bridge.listArchiveExplorerRecords({ dataset: 'problems' });
    await bridge.getArchiveExplorerRecord({ dataset: 'problems', recordId: '1' });
    await bridge.getCoverageSummary('snap');
    await bridge.getCoverageSummary();
    await bridge.listCoverageRecords({ snapshotId: 'snap' });
    await bridge.getCoverageRecord({ problemId: 1 });
    await bridge.getCrawlStatus('snap');
    await bridge.getCrawlStatus();
    await bridge.listJobs();
    await bridge.listJobEvents('job', 5);
    await bridge.startJob({ kind: 'crawl' });
    await bridge.pauseJob('job');
    await bridge.resumeJob('job', { maxIterations: 3 });
    await bridge.startMirrorPreview('snap', 4321);
    await bridge.stopMirrorPreview('job');
    await bridge.openPath('C:/path');
    await bridge.openExternal('https://example.test');

    const channels = invoke.mock.calls.map((call) => call[0]);
    expect(channels).toEqual([
      'desktop:preferences:get',
      'desktop:preferences:set',
      'desktop:workspace:state',
      'desktop:workspace:select',
      'desktop:auth:login',
      'desktop:auth:import-browser',
      'desktop:profiles:create',
      'desktop:profiles:activate',
      'desktop:profiles:delete',
      'desktop:archive:summary',
      'desktop:archive:summary',
      'desktop:archive:list',
      'desktop:archive:detail',
      'desktop:coverage:summary',
      'desktop:coverage:summary',
      'desktop:coverage:list',
      'desktop:coverage:detail',
      'desktop:crawl:status',
      'desktop:crawl:status',
      'desktop:jobs:list',
      'desktop:jobs:events',
      'desktop:jobs:start',
      'desktop:jobs:pause',
      'desktop:jobs:resume',
      'desktop:mirror:start-preview',
      'desktop:mirror:stop-preview',
      'desktop:path:open',
      'desktop:external:open',
    ]);
  });

  test('passes empty payload objects for optional snapshot ids', async () => {
    const { bridge, invoke } = makeBridge();

    await bridge.getArchiveExplorerSummary();
    await bridge.getCoverageSummary();
    await bridge.getCrawlStatus();

    expect(invoke).toHaveBeenNthCalledWith(1, 'desktop:archive:summary', {});
    expect(invoke).toHaveBeenNthCalledWith(2, 'desktop:coverage:summary', {});
    expect(invoke).toHaveBeenNthCalledWith(3, 'desktop:crawl:status', {});
  });

  test('resumeJob forwards optional options unchanged', async () => {
    const { bridge, invoke } = makeBridge();
    await bridge.resumeJob('job');
    expect(invoke).toHaveBeenCalledWith('desktop:jobs:resume', { jobId: 'job' });
  });
});
