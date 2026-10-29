import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/gui/renderer/app.js';
import { buildLogEntries } from '../../src/gui/renderer/dashboard.js';
import type { GuiJobRecord } from '../../src/gui/shared/types.js';
import { createBridgeHarness } from './_helpers/desktop-bridge-harness.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ready = () => screen.findByRole('heading', { name: 'Problem Archive Crawler' });

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('App ignores results that arrive after unmount', () => {
  test('a late preferences result is dropped', async () => {
    const harness = createBridgeHarness();
    const preferences = deferred<unknown>();
    vi.mocked(harness.bridge.getDesktopPreferences).mockReturnValueOnce(
      preferences.promise as never,
    );
    const view = render(<App desktop={harness.bridge} />);
    view.unmount();
    preferences.resolve({ verbosityMode: 'raw' });
    await settle();
    expect(harness.bridge.getDesktopPreferences).toHaveBeenCalledTimes(1);
  });

  test('a late preferences failure is dropped', async () => {
    const harness = createBridgeHarness();
    const preferences = deferred<unknown>();
    vi.mocked(harness.bridge.getDesktopPreferences).mockReturnValueOnce(
      preferences.promise as never,
    );
    const view = render(<App desktop={harness.bridge} />);
    view.unmount();
    preferences.reject(new Error('late failure'));
    await settle();
    expect(harness.bridge.getDesktopPreferences).toHaveBeenCalledTimes(1);
  });
});

describe('App background refresh and empty job results', () => {
  test('the refresh timer reloads the workspace', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const harness = createBridgeHarness();
    render(<App desktop={harness.bridge} />);
    await ready();
    await waitFor(() => {
      expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 3_000)).toBe(true);
    });
    const before = vi.mocked(harness.bridge.getWorkspaceState).mock.calls.length;
    const [tick] = setIntervalSpy.mock.calls.find(([, delay]) => delay === 3_000) ?? [];
    await act(async () => {
      (tick as () => void)();
      await settle();
    });
    expect(vi.mocked(harness.bridge.getWorkspaceState).mock.calls.length).toBeGreaterThan(before);
  });

  test('starting and resuming a crawl tolerate an empty bridge result', async () => {
    const harness = createBridgeHarness();
    vi.mocked(harness.startJob).mockResolvedValue(undefined as never);
    vi.mocked(harness.bridge.resumeJob).mockResolvedValue(undefined as never);
    render(<App desktop={harness.bridge} />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Resume crawl/ }));
    await waitFor(() => {
      expect(harness.startJob).toHaveBeenCalled();
      expect(harness.bridge.resumeJob).toHaveBeenCalled();
    });
  });

  test('a failing job-event load falls back to no events', async () => {
    const harness = createBridgeHarness();
    vi.mocked(harness.bridge.listJobEvents).mockRejectedValue(new Error('events unavailable'));
    render(<App desktop={harness.bridge} />);
    await ready();
    await waitFor(() => {
      expect(harness.bridge.listJobEvents).toHaveBeenCalled();
    });
    expect(screen.getByRole('heading', { name: 'Problem Archive Crawler' })).toBeInTheDocument();
  });
});

describe('buildLogEntries', () => {
  test('orders the latest job events newest first', () => {
    const jobs = [
      { jobId: 'a', latestEvent: { jobId: 'a', timestamp: '2026-03-10T12:00:00.000Z' } },
      { jobId: 'b' },
      { jobId: 'c', latestEvent: { jobId: 'c', timestamp: '2026-03-10T13:00:00.000Z' } },
    ] as unknown as GuiJobRecord[];
    expect(buildLogEntries(jobs).map((event) => event.timestamp)).toEqual([
      '2026-03-10T13:00:00.000Z',
      '2026-03-10T12:00:00.000Z',
    ]);
  });
});
