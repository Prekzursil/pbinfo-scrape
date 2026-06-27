import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const shellMock = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
  openPath: vi.fn(async () => ''),
}));

vi.mock('electron', () => ({ shell: shellMock }));

const { registerDesktopIpc } = await import('../../src/gui/main/ipc.js');

type Handler = (event: unknown, payload?: unknown) => Promise<unknown>;

const tempDirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) {
    savedEnv[key] = process.env[key];
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function register(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  };
  registerDesktopIpc({
    ipcMain: ipcMain as unknown as Parameters<typeof registerDesktopIpc>[0]['ipcMain'],
    userDataRoot: makeDir('pbinfo-ipc-user-'),
  });
  return handlers;
}

beforeEach(() => {
  shellMock.openExternal.mockClear();
  shellMock.openPath.mockClear();
  shellMock.openPath.mockResolvedValue('');
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    delete savedEnv[key];
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('registerDesktopIpc', () => {
  test('registers all desktop channels and gates them on a selected workspace', async () => {
    setEnv('PBINFO_DESKTOP_TEST_DRY_RUN_OPENERS', '1');
    setEnv('PBINFO_DESKTOP_TEST_ACTIONS_PATH', undefined);
    const handlers = register();

    // Before any workspace is selected.
    expect(await handlers.get('desktop:workspace:state')!(null)).toBeNull();
    expect(await handlers.get('desktop:preferences:get')!(null)).toMatchObject({
      verbosityMode: expect.any(String),
    });
    expect(await handlers.get('desktop:jobs:list')!(null)).toEqual([]);
    await expect(handlers.get('desktop:archive:summary')!(null, {})).rejects.toThrow(
      /controller is not ready/,
    );
    await expect(handlers.get('desktop:profiles:create')!(null, {})).rejects.toThrow(
      /No desktop workspace/,
    );

    // Update preferences, then select a workspace (creates the controller).
    await handlers.get('desktop:preferences:set')!(null, { verbosityMode: 'verbose' });
    const workspaceRoot = makeDir('pbinfo-ipc-ws-');
    const state = await handlers.get('desktop:workspace:select')!(null, { workspaceRoot });
    expect(state).toMatchObject({ workspaceRoot });

    // Profile handlers (invalid payloads still execute the handler bodies).
    await expect(handlers.get('desktop:profiles:create')!(null, {})).rejects.toBeInstanceOf(Error);
    await expect(handlers.get('desktop:profiles:activate')!(null, {})).rejects.toThrow(
      'profileId is required.',
    );
    await expect(
      handlers.get('desktop:profiles:activate')!(null, { profileId: 'missing' }),
    ).rejects.toBeInstanceOf(Error);
    expect(
      await handlers.get('desktop:profiles:delete')!(null, { profileId: 'missing' }),
    ).toMatchObject({ workspaceRoot });

    // Data handlers: valid payloads reach the controller (which rejects without
    // archived data — that still exercises the handler body).
    const dataCalls: Array<[string, unknown]> = [
      ['desktop:archive:summary', {}],
      ['desktop:archive:list', { dataset: 'problems' }],
      ['desktop:archive:detail', { dataset: 'problems', recordId: 'x' }],
      ['desktop:coverage:summary', {}],
      ['desktop:coverage:list', {}],
      ['desktop:coverage:detail', { problemId: 1 }],
      ['desktop:jobs:events', { jobId: 'missing' }],
      ['desktop:crawl:status', {}],
    ];
    for (const [channel, payload] of dataCalls) {
      await handlers.get(channel)!(null, payload).then(
        () => undefined,
        () => undefined,
      );
    }

    // Auth handlers reject invalid payloads at the schema boundary.
    await expect(handlers.get('desktop:auth:login')!(null, {})).rejects.toBeInstanceOf(Error);
    await expect(
      handlers.get('desktop:auth:import-browser')!(null, {}),
    ).rejects.toBeInstanceOf(Error);

    // Controller-backed jobs list (now present) returns an array.
    expect(await handlers.get('desktop:jobs:list')!(null)).toEqual([]);

    // Job + mirror forwarding handlers.
    await expect(handlers.get('desktop:jobs:start')!(null, { kind: 'nope' })).rejects.toBeInstanceOf(
      Error,
    );
    await expect(
      handlers.get('desktop:jobs:pause')!(null, { jobId: 'missing' }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      handlers.get('desktop:jobs:resume')!(null, { jobId: 'missing' }),
    ).rejects.toBeInstanceOf(Error);
    await expect(handlers.get('desktop:mirror:start-preview')!(null, {})).rejects.toThrow(
      'snapshotId is required.',
    );
    await expect(
      handlers.get('desktop:mirror:stop-preview')!(null, { jobId: 'missing' }),
    ).rejects.toBeInstanceOf(Error);
  });

  test('records opener actions in dry-run mode without invoking the shell', async () => {
    const actionsPath = join(makeDir('pbinfo-ipc-actions-'), 'actions.json');
    setEnv('PBINFO_DESKTOP_TEST_DRY_RUN_OPENERS', '1');
    setEnv('PBINFO_DESKTOP_TEST_ACTIONS_PATH', actionsPath);
    const handlers = register();

    await handlers.get('desktop:external:open')!(null, { url: 'https://example.com/' });
    await handlers.get('desktop:path:open')!(null, { path: 'C:/tmp/file.txt' });

    const recorded = JSON.parse(readFileSync(actionsPath, 'utf8')) as Array<{ kind: string }>;
    expect(recorded.map((entry) => entry.kind)).toEqual(['openExternal', 'openPath']);
    expect(shellMock.openExternal).not.toHaveBeenCalled();
    expect(shellMock.openPath).not.toHaveBeenCalled();
  });

  test('invokes the shell when dry-run is disabled and surfaces openPath errors', async () => {
    setEnv('PBINFO_DESKTOP_TEST_DRY_RUN_OPENERS', undefined);
    setEnv('PBINFO_DESKTOP_TEST_ACTIONS_PATH', undefined);
    const handlers = register();

    await handlers.get('desktop:external:open')!(null, { url: 'https://example.com/' });
    expect(shellMock.openExternal).toHaveBeenCalledWith('https://example.com/');

    await handlers.get('desktop:path:open')!(null, { path: 'C:/tmp/ok.txt' });
    expect(shellMock.openPath).toHaveBeenCalledWith('C:/tmp/ok.txt');

    shellMock.openPath.mockResolvedValueOnce('Cannot open path');
    await expect(
      handlers.get('desktop:path:open')!(null, { path: 'C:/tmp/bad.txt' }),
    ).rejects.toThrow('Cannot open path');
  });

  test('rethrows non-ENOENT failures when the actions log path is unreadable', async () => {
    const actionsDir = makeDir('pbinfo-ipc-actions-dir-');
    mkdirSync(actionsDir, { recursive: true });
    setEnv('PBINFO_DESKTOP_TEST_DRY_RUN_OPENERS', '1');
    // Point the actions path at a directory so readFileSync fails with EISDIR.
    setEnv('PBINFO_DESKTOP_TEST_ACTIONS_PATH', actionsDir);
    const handlers = register();

    await expect(
      handlers.get('desktop:external:open')!(null, { url: 'https://example.com/' }),
    ).rejects.toBeInstanceOf(Error);
  });
});
