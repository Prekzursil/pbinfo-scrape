import { app, BrowserWindow, ipcMain } from 'electron';
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

let mainWindow: BrowserWindow | undefined;

if (desktopTestUserDataRoot) {
  app.setPath('userData', desktopTestUserDataRoot);
}

if (desktopTestCdpPort) {
  app.commandLine.appendSwitch('remote-debugging-port', desktopTestCdpPort);
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

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
      sandbox: false,
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

    const report = await window.webContents.executeJavaScript(
      `(() => {
        const workspaceRoot = ${JSON.stringify(desktopSmokeWorkspaceRoot ?? '')};

        const headings = () =>
          Array.from(document.querySelectorAll('h1, h2'))
            .map((element) => element.textContent?.trim())
            .filter((value) => Boolean(value));

        const snapshot = () => ({
          headings: headings(),
          text: document.body?.innerText ?? '',
        });

        const waitFor = (predicate, timeoutMs = 15000) =>
          new Promise((resolve, reject) => {
            const deadline = Date.now() + timeoutMs;
            const tick = () => {
              if (predicate()) {
                resolve(undefined);
                return;
              }

              if (Date.now() > deadline) {
                reject(new Error('Timed out waiting for desktop smoke probe condition.'));
                return;
              }

              setTimeout(tick, 100);
            };

            tick();
          });

        const setWorkspaceAndSubmit = (value) => {
          const input = document.querySelector('input');
          const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )?.set;

          if (!(input instanceof HTMLInputElement) || !(input.form instanceof HTMLFormElement)) {
            throw new Error('Desktop smoke probe could not find the workspace bootstrap form.');
          }
          if (!valueSetter) {
            throw new Error('Desktop smoke probe could not access the native input value setter.');
          }

          input.focus();
          valueSetter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          input.form.requestSubmit();
        };

        return waitFor(() => document.body?.innerText.includes('Choose a workspace'))
          .then(() => {
            const initial = snapshot();

            if (!workspaceRoot) {
              return {
                initial,
                final: initial,
              };
            }

            setWorkspaceAndSubmit(workspaceRoot);

            return waitFor(() => document.body?.innerText.includes('Workspace Summary')).then(
              () => ({
                initial,
                final: snapshot(),
              }),
            );
          })
          .catch((error) => ({
            error: error instanceof Error ? error.message : String(error),
            snapshot: snapshot(),
          }));
      })()`,
      true,
    );

    writeDesktopSmokeMarker(
      report && typeof report === 'object' && 'error' in report
        ? {
            phase: 'error',
            ...report,
          }
        : {
            phase: 'completed',
            ...report,
          },
    );
  } catch (error) {
    writeDesktopSmokeMarker({
      phase: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
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
