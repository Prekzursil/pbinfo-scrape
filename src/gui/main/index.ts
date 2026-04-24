import { app, BrowserWindow, ipcMain, session } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerDesktopIpc } from './ipc.js';
import { createElectronNotificationService } from './notification-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererDevServer = process.env.PBINFO_DESKTOP_DEV_SERVER;
const desktopTestCdpPort = process.env.PBINFO_DESKTOP_TEST_CDP_PORT;
const desktopSmokeMarkerPath = process.env.PBINFO_DESKTOP_TEST_MARKER_PATH;
const desktopSmokeWorkspaceRoot = process.env.PBINFO_DESKTOP_TEST_WORKSPACE_ROOT;
const desktopTestUserDataRoot = process.env.PBINFO_DESKTOP_TEST_USER_DATA_ROOT;
const desktopSmokeSnapshotId =
  process.env.PBINFO_DESKTOP_TEST_SNAPSHOT_ID ?? 'acceptance-20260310b';

let mainWindow: BrowserWindow | undefined;

if (desktopTestUserDataRoot) {
  app.setPath('userData', desktopTestUserDataRoot);
}

if (desktopTestCdpPort) {
  app.commandLine.appendSwitch('remote-debugging-port', desktopTestCdpPort);
}

const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
  "frame-src 'self' http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

async function bootstrap(): Promise<void> {
  await app.whenReady();

  // Belt-and-braces CSP: the renderer's index.html already has a <meta http-equiv>
  // tag; this header injection covers dev-server mode (loadURL path) where meta
  // tags from the built HTML may not apply in time.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP_POLICY],
      },
    });
  });

  registerDesktopIpc({
    ipcMain,
    userDataRoot: app.getPath('userData'),
    notificationService: createElectronNotificationService(),
  });

  await bootstrapWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await bootstrapWindow();
    }
  });
}

async function bootstrapWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1120,
    minHeight: 780,
    backgroundColor: '#efe6d9',
    title: 'Problem Archive Crawler',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Task 11 regression discovery: Electron 40 does not load ESM preload
      // files (our tsc output is .js ESM) when sandbox:true is set —
      // contextBridge.exposeInMainWorld never runs and window.pbinfoDesktop
      // ends up empty. Keep sandbox:false until the preload is bundled to
      // CJS (rollup/esbuild) or renamed to .mjs. contextIsolation:true +
      // nodeIntegration:false + the CSP injected at session-start level
      // still provide strong protection against the archived-HTML render
      // surfaces (Statement/Editorial DOMPurify-sanitized).
      sandbox: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  if (rendererDevServer) {
    await mainWindow.loadURL(rendererDevServer);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  await maybeWriteDesktopSmokeMarker(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function maybeWriteDesktopSmokeMarker(
  window: BrowserWindow,
): Promise<void> {
  if (!desktopSmokeMarkerPath) {
    return;
  }

  try {
    writeDesktopSmokeMarker({
      phase: 'window-loaded',
    });

    // Library-browser smoke probe (Task 11). The legacy probe used to click
    // through sidebar tabs + coverage + data explorer; all of that was
    // removed in Task 9. The new probe confirms: (a) the renderer loaded
    // without uncaught errors, (b) archive:state returns, (c) either the
    // LibraryShell or EmptyStateWelcome heading appears in the DOM.
    const snapshotId = desktopSmokeSnapshotId;
    const report = await window.webContents.executeJavaScript(
      `(async () => {
        const bridge = window.pbinfoDesktop;
        const waitFor = (predicate, timeoutMs = 15000) =>
          new Promise((resolve, reject) => {
            const deadline = Date.now() + timeoutMs;
            const tick = () => {
              try {
                if (predicate()) { resolve(undefined); return; }
              } catch { /* ignore and retry */ }
              if (Date.now() > deadline) {
                reject(new Error('Timed out waiting for desktop smoke probe condition.'));
                return;
              }
              setTimeout(tick, 100);
            };
            tick();
          });

        const headings = () =>
          Array.from(document.querySelectorAll('h1, h2'))
            .map((el) => el.textContent?.trim())
            .filter(Boolean);

        try {
          if (!bridge?.archive) {
            return { error: 'bridge.archive is not exposed on window.pbinfoDesktop' };
          }
          const archiveState = await bridge.archive.getState();
          await waitFor(() => headings().length > 0, 15000);
          // If archive is found, wait for library:problems:list to resolve
          // so the "0 problems" count reflects real data.
          let rowCount = 0;
          if (archiveState.found) {
            try {
              await waitFor(() => {
                const countEl = document.querySelector('.library-shell__count');
                const match = countEl?.textContent?.match(/([0-9,]+)/);
                rowCount = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
                return rowCount > 0;
              }, 10000);
            } catch { /* leave rowCount = 0 */ }
          }
          const finalHeadings = headings();
          const mounted = finalHeadings.some((h) =>
            /welcome to problem archive crawler|problem archive crawler/i.test(h),
          );
          return {
            archiveFound: archiveState.found,
            archiveSnapshotId: archiveState.snapshotId,
            probedPaths: archiveState.probedPaths,
            libraryShellMounted: Boolean(archiveState.found && mounted),
            emptyStateMounted: Boolean(!archiveState.found && mounted),
            finalHeadings,
            rowCount,
            text: document.body?.innerText?.slice(0, 2000) ?? '',
            expectedSnapshotId: ${JSON.stringify(snapshotId)},
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
            finalHeadings: headings(),
          };
        }
      })()`,
      true,
    );

    writeDesktopSmokeMarker(
      report && typeof report === 'object' && 'error' in report
        ? { phase: 'error', ...report }
        : { phase: 'completed', ...report },
    );
    return;
  } catch (error) {
    writeDesktopSmokeMarker({
      phase: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
}


function writeDesktopSmokeMarker(payload: Record<string, unknown>): void {
  if (!desktopSmokeMarkerPath) {
    return;
  }

  mkdirSync(dirname(desktopSmokeMarkerPath), {
    recursive: true,
  });
  writeFileSync(desktopSmokeMarkerPath, JSON.stringify(payload, null, 2), 'utf8');
}

void bootstrap();
