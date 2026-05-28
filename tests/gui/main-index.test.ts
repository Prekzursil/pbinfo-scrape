import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Programmable electron + ipc harness so the desktop main entrypoint can be
 * bootstrapped headlessly. Each scenario resets modules and re-imports
 * `index.ts`, which runs its top-level `void bootstrap()` against this harness.
 */
interface WebContentsStub {
  executeJavaScript: ReturnType<typeof vi.fn>;
}

interface WindowStub {
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  webContents: WebContentsStub;
  closedListener?: () => void;
}

const harness = {
  appListeners: new Map<string, (...args: unknown[]) => unknown>(),
  windows: [] as WindowStub[],
  executeJavaScriptResult: undefined as unknown,
  executeJavaScriptError: undefined as Error | undefined,
  allWindowsLength: 0,
  setPath: vi.fn<(key: string, value: string) => void>(),
  getPath: vi.fn<(key: string) => string>(() => '/user-data'),
  appendSwitch: vi.fn<(key: string, value: string) => void>(),
  quit: vi.fn(),
  whenReady: vi.fn(async () => undefined),
  registerDesktopIpc: vi.fn<(options: unknown) => void>(),
  createNotificationService: vi.fn(() => ({ notify: vi.fn() })),
};

function makeWindow(): WindowStub {
  const window: WindowStub = {
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'closed') {
        window.closedListener = listener;
      }
    }),
    webContents: {
      executeJavaScript: vi.fn(async () => {
        if (harness.executeJavaScriptError) {
          throw harness.executeJavaScriptError;
        }
        return harness.executeJavaScriptResult;
      }),
    },
  };
  harness.windows.push(window);
  return window;
}

vi.mock('electron', () => ({
  app: {
    whenReady: () => harness.whenReady(),
    setPath: (key: string, value: string) => harness.setPath(key, value),
    getPath: (key: string) => harness.getPath(key),
    quit: () => harness.quit(),
    commandLine: {
      appendSwitch: (key: string, value: string) => harness.appendSwitch(key, value),
    },
    on: (event: string, listener: (...args: unknown[]) => unknown) => {
      harness.appListeners.set(event, listener);
    },
  },
  BrowserWindow: Object.assign(
    vi.fn(() => makeWindow()),
    {
      getAllWindows: () => new Array(harness.allWindowsLength).fill({}),
    },
  ),
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../../src/gui/main/ipc.js', () => ({
  registerDesktopIpc: (options: unknown) => harness.registerDesktopIpc(options),
}));

vi.mock('../../src/gui/main/notification-service.js', () => ({
  createElectronNotificationService: () => harness.createNotificationService(),
}));

const tempDirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
const envKeys = [
  'PBINFO_DESKTOP_DEV_SERVER',
  'PBINFO_DESKTOP_TEST_CDP_PORT',
  'PBINFO_DESKTOP_TEST_MARKER_PATH',
  'PBINFO_DESKTOP_TEST_WORKSPACE_ROOT',
  'PBINFO_DESKTOP_TEST_USER_DATA_ROOT',
  'PBINFO_DESKTOP_TEST_SNAPSHOT_ID',
];

function resetHarness() {
  harness.appListeners.clear();
  harness.windows.length = 0;
  harness.executeJavaScriptResult = undefined;
  harness.executeJavaScriptError = undefined;
  harness.allWindowsLength = 0;
  harness.setPath.mockClear();
  harness.appendSwitch.mockClear();
  harness.quit.mockClear();
  harness.registerDesktopIpc.mockClear();
}

async function loadIndex(): Promise<void> {
  vi.resetModules();
  await import('../../src/gui/main/index.js');
  // Allow the fire-and-forget bootstrap() promise chain to settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetHarness();
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('desktop main entrypoint', () => {
  test('bootstraps a window from the bundled renderer file by default', async () => {
    await loadIndex();

    expect(harness.registerDesktopIpc).toHaveBeenCalledWith(
      expect.objectContaining({ userDataRoot: '/user-data' }),
    );
    expect(harness.windows).toHaveLength(1);
    expect(harness.windows[0]!.loadFile).toHaveBeenCalledTimes(1);
    expect(harness.windows[0]!.loadURL).not.toHaveBeenCalled();
  });

  test('loads the dev server url and honors cdp + user-data overrides', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-index-userdata-'));
    tempDirs.push(userData);
    process.env.PBINFO_DESKTOP_DEV_SERVER = 'http://127.0.0.1:5173';
    process.env.PBINFO_DESKTOP_TEST_CDP_PORT = '9333';
    process.env.PBINFO_DESKTOP_TEST_USER_DATA_ROOT = userData;

    await loadIndex();

    expect(harness.setPath).toHaveBeenCalledWith('userData', userData);
    expect(harness.appendSwitch).toHaveBeenCalledWith('remote-debugging-port', '9333');
    expect(harness.windows[0]!.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173');
  });

  test('re-creates a window on activate only when none are open', async () => {
    await loadIndex();
    const activate = harness.appListeners.get('activate');
    expect(activate).toBeTypeOf('function');

    harness.allWindowsLength = 1;
    await activate?.();
    expect(harness.windows).toHaveLength(1);

    harness.allWindowsLength = 0;
    await activate?.();
    expect(harness.windows).toHaveLength(2);
  });

  test('quits on window-all-closed on non-darwin platforms only', async () => {
    await loadIndex();
    const windowAllClosed = harness.appListeners.get('window-all-closed');
    const original = Object.getOwnPropertyDescriptor(process, 'platform');

    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    windowAllClosed?.();
    expect(harness.quit).toHaveBeenCalledTimes(1);

    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    windowAllClosed?.();
    expect(harness.quit).toHaveBeenCalledTimes(1);

    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  });

  test('clears the window reference when the window is closed', async () => {
    await loadIndex();
    expect(harness.windows[0]!.closedListener).toBeTypeOf('function');
    harness.windows[0]!.closedListener?.();
    // Re-activating with no windows open should build a fresh window.
    harness.allWindowsLength = 0;
    await harness.appListeners.get('activate')?.();
    expect(harness.windows).toHaveLength(2);
  });

  test('writes a completed smoke marker after probing the renderer', async () => {
    const markerDir = mkdtempSync(join(tmpdir(), 'pbinfo-index-marker-'));
    tempDirs.push(markerDir);
    const markerPath = join(markerDir, 'nested', 'marker.json');
    process.env.PBINFO_DESKTOP_TEST_MARKER_PATH = markerPath;
    process.env.PBINFO_DESKTOP_TEST_WORKSPACE_ROOT = '/ws';
    process.env.PBINFO_DESKTOP_TEST_SNAPSHOT_ID = 'snap-x';
    harness.executeJavaScriptResult = { headings: ['Archive Overview'] };

    await loadIndex();

    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    expect(marker).toMatchObject({ phase: 'completed', headings: ['Archive Overview'] });
  });

  test('writes an error smoke marker when the probe reports an error', async () => {
    const markerDir = mkdtempSync(join(tmpdir(), 'pbinfo-index-marker-err-'));
    tempDirs.push(markerDir);
    const markerPath = join(markerDir, 'marker.json');
    process.env.PBINFO_DESKTOP_TEST_MARKER_PATH = markerPath;
    harness.executeJavaScriptResult = { error: 'probe failed', snapshot: {} };

    await loadIndex();

    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    expect(marker).toMatchObject({ phase: 'error', error: 'probe failed' });
  });

  test('writes an error smoke marker when executeJavaScript throws', async () => {
    const markerDir = mkdtempSync(join(tmpdir(), 'pbinfo-index-marker-throw-'));
    tempDirs.push(markerDir);
    const markerPath = join(markerDir, 'marker.json');
    process.env.PBINFO_DESKTOP_TEST_MARKER_PATH = markerPath;
    harness.executeJavaScriptError = new Error('execute exploded');

    await loadIndex();

    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    expect(marker).toMatchObject({ phase: 'error', error: 'execute exploded' });
  });

  test('stringifies non-error probe failures in the smoke marker', async () => {
    const markerDir = mkdtempSync(join(tmpdir(), 'pbinfo-index-marker-nonerror-'));
    tempDirs.push(markerDir);
    const markerPath = join(markerDir, 'marker.json');
    process.env.PBINFO_DESKTOP_TEST_MARKER_PATH = markerPath;
    harness.executeJavaScriptError = 'string rejection' as unknown as Error;

    await loadIndex();

    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    expect(marker).toMatchObject({ phase: 'error', error: 'string rejection' });
  });
});
