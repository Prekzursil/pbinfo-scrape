import { describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => {
  const BrowserWindow = vi
    .fn()
    .mockImplementation((opts: { webPreferences?: Record<string, unknown> }) => {
      return {
        id: 42,
        loadURL: vi.fn(),
        webContents: {
          setWindowOpenHandler: vi.fn(),
          on: vi.fn(),
        },
        __opts: opts,
      };
    });
  return { BrowserWindow };
});

import { BrowserWindow } from 'electron';
import {
  buildLiveSiteUrl,
  openLiveSiteViewerChildWindow,
} from '../../../src/gui/main/live-site-viewer-window.js';

describe('buildLiveSiteUrl', () => {
  test('returns the problem index when problemId is undefined', () => {
    expect(buildLiveSiteUrl(undefined)).toBe(
      'https://www.pbinfo.ro/probleme',
    );
  });

  test('encodes the problemId', () => {
    expect(buildLiveSiteUrl('1234')).toBe(
      'https://www.pbinfo.ro/probleme/1234',
    );
  });

  test('URL-encodes non-numeric problemIds defensively', () => {
    expect(buildLiveSiteUrl('a b/c')).toBe(
      'https://www.pbinfo.ro/probleme/a%20b%2Fc',
    );
  });
});

describe('openLiveSiteViewerChildWindow', () => {
  test('creates a BrowserWindow with sandbox:true + contextIsolation:true', () => {
    const result = openLiveSiteViewerChildWindow({ problemId: '100' });

    expect(result.childWindowId).toBe(42);
    const BwMock = BrowserWindow as unknown as ReturnType<typeof vi.fn>;
    const lastCall = BwMock.mock.calls.at(-1);
    expect(lastCall?.[0].webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    });
  });

  test('loads the problem URL', () => {
    openLiveSiteViewerChildWindow({ problemId: '42' });
    const BwMock = BrowserWindow as unknown as ReturnType<typeof vi.fn>;
    const instance = BwMock.mock.results.at(-1)?.value as {
      loadURL: ReturnType<typeof vi.fn>;
    };
    expect(instance.loadURL).toHaveBeenCalledWith(
      'https://www.pbinfo.ro/probleme/42',
    );
  });

  test('registers a will-navigate handler that blocks offsite nav', () => {
    openLiveSiteViewerChildWindow({});
    const BwMock = BrowserWindow as unknown as ReturnType<typeof vi.fn>;
    const instance = BwMock.mock.results.at(-1)?.value as {
      webContents: { on: ReturnType<typeof vi.fn> };
    };
    const match = instance.webContents.on.mock.calls.find(
      (call) => call[0] === 'will-navigate',
    );
    expect(match).toBeDefined();
    const listener = match?.[1] as (
      evt: { preventDefault: () => void },
      url: string,
    ) => void;

    const blocked = { preventDefault: vi.fn() };
    listener(blocked, 'https://evil.example/boom');
    expect(blocked.preventDefault).toHaveBeenCalled();

    const allowed = { preventDefault: vi.fn() };
    listener(allowed, 'https://www.pbinfo.ro/something');
    expect(allowed.preventDefault).not.toHaveBeenCalled();
  });
});
