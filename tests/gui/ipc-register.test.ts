import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const shellOpenExternal = vi.fn<(url: string) => Promise<void>>();
const shellOpenPath = vi.fn<(path: string) => Promise<string>>(async () => '');

vi.mock('electron', () => ({
  shell: {
    openExternal: (url: string) => shellOpenExternal(url),
    openPath: (path: string) => shellOpenPath(path),
  },
}));

const { registerDesktopIpc } = await import('../../src/gui/main/ipc.js');
const { writeDesktopPreferences } = await import('../../src/gui/main/desktop-preferences.js');

type Handler = (event: unknown, payload?: unknown) => unknown;

function fakeIpcMain() {
  const handlers = new Map<string, Handler>();
  const handle = ((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  }) as unknown as Parameters<typeof registerDesktopIpc>[0]['ipcMain']['handle'];
  return {
    ipcMain: { handle },
    invoke: (channel: string, payload?: unknown) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`no handler for ${channel}`);
      }
      return handler({}, payload);
    },
    handlers,
  };
}

const tempDirs: string[] = [];

function makeWorkspace(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  delete process.env.PBINFO_DESKTOP_TEST_ACTIONS_PATH;
  delete process.env.PBINFO_DESKTOP_TEST_DRY_RUN_OPENERS;
  shellOpenExternal.mockClear();
  shellOpenPath.mockClear();
  shellOpenPath.mockResolvedValue('');
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('registerDesktopIpc', () => {
  test('returns null/empty before a workspace is selected and rejects controller-bound calls', async () => {
    const userDataRoot = makeWorkspace('pbinfo-ipc-empty-');
    const ipc = fakeIpcMain();
    registerDesktopIpc({ ipcMain: ipc.ipcMain, userDataRoot });

    expect(await ipc.invoke('desktop:workspace:state')).toBeNull();
    expect(await ipc.invoke('desktop:preferences:get')).toEqual({ verbosityMode: 'normal' });
    expect(await ipc.invoke('desktop:jobs:list')).toEqual([]);

    await expect(ipc.invoke('desktop:archive:summary', {})).rejects.toThrow(
      /controller is not ready/i,
    );
    await expect(ipc.invoke('desktop:profiles:create', { profileId: 'p' })).rejects.toThrow(
      /No desktop workspace/i,
    );
    await expect(ipc.invoke('desktop:profiles:activate', {})).rejects.toThrow(
      /No desktop workspace/i,
    );
  });

  test('selects a workspace, persists preferences, and updates verbosity', async () => {
    const userDataRoot = makeWorkspace('pbinfo-ipc-prefs-');
    const workspaceRoot = makeWorkspace('pbinfo-ipc-ws-');
    const ipc = fakeIpcMain();
    registerDesktopIpc({ ipcMain: ipc.ipcMain, userDataRoot });

    const state = await ipc.invoke('desktop:workspace:select', { workspaceRoot });
    expect(state).not.toBeNull();
    expect(await ipc.invoke('desktop:workspace:state')).not.toBeNull();

    const updated = await ipc.invoke('desktop:preferences:set', { verbosityMode: 'raw' });
    expect(updated).toMatchObject({ verbosityMode: 'raw', workspaceRoot });
  });

  test('resumes a previously persisted workspace on startup', async () => {
    const userDataRoot = makeWorkspace('pbinfo-ipc-persisted-');
    const workspaceRoot = makeWorkspace('pbinfo-ipc-persisted-ws-');
    writeDesktopPreferences(userDataRoot, { verbosityMode: 'normal', workspaceRoot });

    const ipc = fakeIpcMain();
    registerDesktopIpc({ ipcMain: ipc.ipcMain, userDataRoot });

    await expect(ipc.invoke('desktop:jobs:list')).resolves.toEqual([]);
    expect(await ipc.invoke('desktop:workspace:state')).not.toBeNull();
  });

  test('forwards profile, archive, coverage, jobs, and mirror channels to the controller', async () => {
    const userDataRoot = makeWorkspace('pbinfo-ipc-fwd-data-');
    const workspaceRoot = makeWorkspace('pbinfo-ipc-fwd-ws-');
    const ipc = fakeIpcMain();
    registerDesktopIpc({ ipcMain: ipc.ipcMain, userDataRoot });
    await ipc.invoke('desktop:workspace:select', { workspaceRoot });

    const profile = await ipc.invoke('desktop:profiles:create', {
      profileId: 'alpha',
      label: 'Primary',
      provenance: { type: 'cookie-import' },
      sessionCookies: [{ key: 'PHPSESSID', value: 'v', domain: 'www.pbinfo.ro', path: '/' }],
    });
    expect(profile).toMatchObject({ profileId: 'alpha' });
    await ipc.invoke('desktop:profiles:activate', { profileId: 'alpha' });
    await ipc.invoke('desktop:profiles:delete', { profileId: 'alpha' });

    // Without a prepared snapshot these forward to the controller and surface its error,
    // which still exercises every IPC handler line.
    await expect(ipc.invoke('desktop:archive:summary', {})).rejects.toBeInstanceOf(Error);
    await expect(
      ipc.invoke('desktop:archive:list', { dataset: 'problems' }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      ipc.invoke('desktop:archive:detail', { dataset: 'problems', recordId: '1' }),
    ).rejects.toBeInstanceOf(Error);
    await expect(ipc.invoke('desktop:coverage:summary', {})).rejects.toBeInstanceOf(Error);
    await expect(ipc.invoke('desktop:coverage:list', {})).rejects.toBeInstanceOf(Error);
    await expect(ipc.invoke('desktop:coverage:detail', { problemId: 1 })).rejects.toBeInstanceOf(
      Error,
    );
    await expect(ipc.invoke('desktop:auth:login', {})).rejects.toBeInstanceOf(Error);
    await expect(ipc.invoke('desktop:auth:import-browser', {})).rejects.toBeInstanceOf(Error);

    await expect(ipc.invoke('desktop:jobs:list')).resolves.toEqual([]);
    await expect(ipc.invoke('desktop:crawl:status', {})).rejects.toBeInstanceOf(Error);

    // A schema-valid job-start payload reaches the controller registry wrapper.
    await expect(
      ipc.invoke('desktop:jobs:start', { kind: 'rank', snapshotId: 'unknown-snap' }),
    ).resolves.toMatchObject({ kind: 'rank' });
    await expect(ipc.invoke('desktop:jobs:start', { kind: 'publish' })).rejects.toThrow();
    await expect(ipc.invoke('desktop:jobs:pause', { jobId: 'missing' })).rejects.toThrow();
    await expect(ipc.invoke('desktop:jobs:resume', { jobId: 'missing' })).rejects.toThrow();
    await expect(ipc.invoke('desktop:mirror:start-preview', { snapshotId: 'x' })).rejects.toThrow();
    await expect(ipc.invoke('desktop:mirror:stop-preview', { jobId: 'missing' })).rejects.toThrow();
    await expect(ipc.invoke('desktop:jobs:events', { jobId: 'missing' })).rejects.toBeInstanceOf(
      Error,
    );

    // Missing identifiers are rejected before reaching the controller.
    await expect(ipc.invoke('desktop:profiles:activate', {})).rejects.toThrow(/profileId/i);
    await expect(ipc.invoke('desktop:jobs:pause', {})).rejects.toThrow(/jobId/i);
    await expect(ipc.invoke('desktop:mirror:start-preview', {})).rejects.toThrow(/snapshotId/i);
  });

  test('opens external urls and filesystem paths via electron shell', async () => {
    const userDataRoot = makeWorkspace('pbinfo-ipc-open-');
    const ipc = fakeIpcMain();
    registerDesktopIpc({ ipcMain: ipc.ipcMain, userDataRoot });

    await ipc.invoke('desktop:external:open', { url: 'https://example.test' });
    await ipc.invoke('desktop:path:open', { path: '/tmp/here' });

    expect(shellOpenExternal).toHaveBeenCalledWith('https://example.test');
    expect(shellOpenPath).toHaveBeenCalledWith('/tmp/here');
  });

  test('throws when electron shell.openPath reports an error message', async () => {
    const userDataRoot = makeWorkspace('pbinfo-ipc-openfail-');
    const ipc = fakeIpcMain();
    registerDesktopIpc({ ipcMain: ipc.ipcMain, userDataRoot });
    shellOpenPath.mockResolvedValueOnce('cannot open');

    await expect(ipc.invoke('desktop:path:open', { path: '/bad' })).rejects.toThrow('cannot open');
  });

  test('records dry-run opener actions to a test actions file without invoking shell', async () => {
    const userDataRoot = makeWorkspace('pbinfo-ipc-dryrun-');
    const actionsPath = join(makeWorkspace('pbinfo-ipc-actions-'), 'nested', 'actions.json');
    process.env.PBINFO_DESKTOP_TEST_ACTIONS_PATH = actionsPath;
    process.env.PBINFO_DESKTOP_TEST_DRY_RUN_OPENERS = '1';

    const ipc = fakeIpcMain();
    registerDesktopIpc({ ipcMain: ipc.ipcMain, userDataRoot });

    await ipc.invoke('desktop:external:open', { url: 'https://example.test' });
    await ipc.invoke('desktop:path:open', { path: '/tmp/here' });

    expect(shellOpenExternal).not.toHaveBeenCalled();
    expect(shellOpenPath).not.toHaveBeenCalled();
    expect(existsSync(actionsPath)).toBe(true);
    const recorded = JSON.parse(readFileSync(actionsPath, 'utf8'));
    expect(recorded).toEqual([
      { kind: 'openExternal', target: 'https://example.test' },
      { kind: 'openPath', target: '/tmp/here' },
    ]);
  });
});
