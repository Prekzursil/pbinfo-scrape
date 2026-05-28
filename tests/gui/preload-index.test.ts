import { describe, expect, test, vi } from 'vitest';

const ipcInvoke = vi.fn<(channel: string, payload?: unknown) => Promise<string>>(
  async () => 'invoked',
);
const ipcOn = vi.fn<(channel: string, listener: (...args: unknown[]) => void) => void>();
const ipcRemoveListener =
  vi.fn<(channel: string, listener: (...args: unknown[]) => void) => void>();
const exposeInMainWorld = vi.fn<(key: string, value: unknown) => void>();
const exposed: Record<string, unknown> = {};

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed[key] = value;
      exposeInMainWorld(key, value);
    },
  },
  ipcRenderer: {
    invoke: (channel: string, payload?: unknown) => ipcInvoke(channel, payload),
    on: (channel: string, listener: (...args: unknown[]) => void) => ipcOn(channel, listener),
    removeListener: (channel: string, listener: (...args: unknown[]) => void) =>
      ipcRemoveListener(channel, listener),
  },
}));

describe('preload bootstrap', () => {
  test('exposes the desktop bridge wired to ipcRenderer', async () => {
    await import('../../src/gui/preload/index.js');

    expect(exposeInMainWorld).toHaveBeenCalledWith('pbinfoDesktop', expect.any(Object));
    const bridge = exposed.pbinfoDesktop as {
      getDesktopPreferences: () => Promise<unknown>;
    };

    await bridge.getDesktopPreferences();
    expect(ipcInvoke).toHaveBeenCalledWith('desktop:preferences:get', undefined);
  });

  test('ipcRenderer adapter subscribes via on and removes listeners on unsubscribe', async () => {
    const { createIpcRendererAdapter } = await import('../../src/gui/preload/index.js');
    const { buildDesktopBridge } = await import('../../src/gui/preload/api.js');

    let captured: ((...args: unknown[]) => void) | undefined;
    ipcOn.mockImplementation((_channel: string, listener: (...args: unknown[]) => void) => {
      captured = listener;
    });

    const adapter = createIpcRendererAdapter({
      invoke: (channel: string, payload?: unknown) => ipcInvoke(channel, payload),
      on: (channel: string, listener: (...args: unknown[]) => void) => ipcOn(channel, listener),
      removeListener: (channel: string, listener: (...args: unknown[]) => void) =>
        ipcRemoveListener(channel, listener),
    } as never);

    const nested = buildDesktopBridge(adapter);

    const received: unknown[] = [];
    const unsubscribe = nested.events.subscribe('jobs:updated', (payload) =>
      received.push(payload),
    );
    captured?.({}, { jobId: 'j1' });
    unsubscribe();

    expect(received).toEqual([{ jobId: 'j1' }]);
    expect(ipcRemoveListener).toHaveBeenCalled();

    await adapter.invoke('desktop:preferences:get');
    expect(ipcInvoke).toHaveBeenCalledWith('desktop:preferences:get', undefined);
  });
});
