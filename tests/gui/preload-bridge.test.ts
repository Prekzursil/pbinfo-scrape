import { describe, expect, test, vi } from 'vitest';

import { buildDesktopBridge } from '../../src/gui/preload/api.js';

describe('desktop preload bridge', () => {
  test('forwards renderer-safe requests over invoke channels', async () => {
    const invoke = vi.fn(async (channel: string, payload?: unknown) => ({
      channel,
      payload,
    }));
    const bridge = buildDesktopBridge({
      invoke,
      on: vi.fn(),
      off: vi.fn(),
    });

    const result = await bridge.jobs.start({
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
    });

    expect(invoke).toHaveBeenCalledWith('desktop:jobs:start', {
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
    });
    expect(result).toEqual({
      channel: 'desktop:jobs:start',
      payload: {
        kind: 'crawl',
        snapshotId: 'acceptance-20260310b',
      },
    });
  });

  test('forwards auth, crawl-status, and preference update requests over dedicated channels', async () => {
    const invoke = vi.fn(async (channel: string, payload?: unknown) => ({
      channel,
      payload,
    }));
    const bridge = buildDesktopBridge({
      invoke,
      on: vi.fn(),
      off: vi.fn(),
    });

    const authResult = await bridge.auth.login({
      profileId: 'alpha',
      label: 'Primary account',
      username: 'Prekzursil',
      password: 'secret',
    });
    const statusResult = await bridge.crawl.status({
      snapshotId: 'acceptance-20260310b',
    });
    const preferencesResult = await bridge.preferences.set({
      verbosityMode: 'raw',
    });

    expect(authResult).toEqual({
      channel: 'desktop:auth:login',
      payload: {
        profileId: 'alpha',
        label: 'Primary account',
        username: 'Prekzursil',
        password: 'secret',
      },
    });
    expect(statusResult).toEqual({
      channel: 'desktop:crawl:status',
      payload: {
        snapshotId: 'acceptance-20260310b',
      },
    });
    expect(preferencesResult).toEqual({
      channel: 'desktop:preferences:set',
      payload: {
        verbosityMode: 'raw',
      },
    });
  });

  test('forwards archive explorer and path-open requests over dedicated channels', async () => {
    const invoke = vi.fn(async (channel: string, payload?: unknown) => ({
      channel,
      payload,
    }));
    const bridge = buildDesktopBridge({
      invoke,
      on: vi.fn(),
      off: vi.fn(),
    });

    const summary = await bridge.archive.summary({
      snapshotId: 'acceptance-20260310b',
    });
    const listing = await bridge.archive.list({
      snapshotId: 'acceptance-20260310b',
      dataset: 'problems',
      query: 'waterreserve',
    });
    const detail = await bridge.archive.detail({
      snapshotId: 'acceptance-20260310b',
      dataset: 'problems',
      recordId: '3171',
    });
    const openedPath = await bridge.paths.open(
      'C:/archive/snapshots/acceptance-20260310b/normalized',
    );

    expect(summary).toEqual({
      channel: 'desktop:archive:summary',
      payload: {
        snapshotId: 'acceptance-20260310b',
      },
    });
    expect(listing).toEqual({
      channel: 'desktop:archive:list',
      payload: {
        snapshotId: 'acceptance-20260310b',
        dataset: 'problems',
        query: 'waterreserve',
      },
    });
    expect(detail).toEqual({
      channel: 'desktop:archive:detail',
      payload: {
        snapshotId: 'acceptance-20260310b',
        dataset: 'problems',
        recordId: '3171',
      },
    });
    expect(openedPath).toEqual({
      channel: 'desktop:path:open',
      payload: {
        path: 'C:/archive/snapshots/acceptance-20260310b/normalized',
      },
    });
  });

  test('forwards desktop preference reads and verbosity updates over dedicated channels', async () => {
    const invoke = vi.fn(async (channel: string, payload?: unknown) => ({
      channel,
      payload,
    }));
    const bridge = buildDesktopBridge({
      invoke,
      on: vi.fn(),
      off: vi.fn(),
    });

    const preferences = await bridge.preferences.get();
    const updated = await bridge.preferences.set({
      verbosityMode: 'raw',
    });

    expect(preferences).toEqual({
      channel: 'desktop:preferences:get',
      payload: undefined,
    });
    expect(updated).toEqual({
      channel: 'desktop:preferences:set',
      payload: {
        verbosityMode: 'raw',
      },
    });
  });

  test('subscribes and unsubscribes to structured desktop events without exposing ipcRenderer', () => {
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    const on = vi.fn(
      (
        channel: string,
        listener: (event: unknown, payload: unknown) => void,
      ) => {
        const wrapped = (payload: unknown) => listener({}, payload);
        const current = handlers.get(channel) ?? new Set();
        current.add(wrapped);
        handlers.set(channel, current);
        return () => current.delete(wrapped);
      },
    );
    const off = vi.fn();
    const bridge = buildDesktopBridge({
      invoke: vi.fn(),
      on,
      off,
    });
    const listener = vi.fn();

    const unsubscribe = bridge.events.subscribe('jobs:updated', listener);
    for (const handler of handlers.get('desktop:events:jobs:updated') ?? []) {
      handler({
        jobId: 'crawl-job-1',
      });
    }
    unsubscribe();

    expect(listener).toHaveBeenCalledWith({
      jobId: 'crawl-job-1',
    });
    expect(off).toHaveBeenCalledWith('desktop:events:jobs:updated');
  });

  test('reads desktop preferences over a renderer-safe channel', async () => {
    const invoke = vi.fn(async (channel: string, payload?: unknown) => ({
      channel,
      payload,
    }));
    const bridge = buildDesktopBridge({
      invoke,
      on: vi.fn(),
      off: vi.fn(),
    });

    const result = await bridge.preferences.get();

    expect(result).toEqual({
      channel: 'desktop:preferences:get',
      payload: undefined,
    });
  });
});
