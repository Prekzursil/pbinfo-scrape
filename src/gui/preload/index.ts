import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRenderer } from 'electron';

import { createDesktopBridge } from './api.js';
import type { DesktopBridgeAdapter } from '../shared/bridge.js';

export function createIpcRendererAdapter(renderer: IpcRenderer): DesktopBridgeAdapter {
  return {
    invoke: (channel, payload) => renderer.invoke(channel, payload),
    on: (channel, listener) => {
      const subscription = (_event: unknown, ...args: unknown[]) => {
        listener(...args);
      };
      renderer.on(channel, subscription);
      return () => {
        renderer.removeListener(channel, subscription);
      };
    },
  };
}

const bridge = createDesktopBridge(createIpcRendererAdapter(ipcRenderer));

contextBridge.exposeInMainWorld('pbinfoDesktop', bridge);
