import { contextBridge, ipcRenderer } from 'electron';

import { createDesktopBridge } from './api.js';

const bridge = createDesktopBridge({
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, listener) => {
    const subscription = (_event: unknown, ...args: unknown[]) => {
      listener(...args);
    };
    ipcRenderer.on(channel, subscription);
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
});

contextBridge.exposeInMainWorld('pbinfoDesktop', bridge);
