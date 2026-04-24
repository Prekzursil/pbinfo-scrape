import { BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));

export interface OpenLiveSiteViewerInput {
  readonly problemId?: string;
}

export interface OpenLiveSiteViewerResult {
  readonly childWindowId: number;
}

const PBINFO_ORIGIN = 'https://www.pbinfo.ro';

export function buildLiveSiteUrl(problemId: string | undefined): string {
  if (!problemId) {
    return `${PBINFO_ORIGIN}/probleme`;
  }
  return `${PBINFO_ORIGIN}/probleme/${encodeURIComponent(problemId)}`;
}

export function openLiveSiteViewerChildWindow(
  input: OpenLiveSiteViewerInput,
): OpenLiveSiteViewerResult {
  const child = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'pbinfo.ro (live)',
    webPreferences: {
      preload: join(moduleDir, '../preload/live-site-viewer.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  child.loadURL(buildLiveSiteUrl(input.problemId));

  // Defense in depth: block window-open and offsite navigation.
  child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  child.webContents.on(
    'will-navigate',
    (event: { preventDefault: () => void }, navigationUrl: string) => {
      if (!navigationUrl.startsWith(`${PBINFO_ORIGIN}/`)) {
        event.preventDefault();
      }
    },
  );

  return { childWindowId: child.id };
}
