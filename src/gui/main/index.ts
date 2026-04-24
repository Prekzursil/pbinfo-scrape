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
      // Task 9: sandbox: true hardens the process against untrusted HTML
      // rendered in the Statement / Editorial drawer tabs. The preload uses
      // contextBridge.exposeInMainWorld + ipcRenderer.invoke, both sandbox-
      // compatible. If you see regressions from this, prefer fixing the
      // preload over reverting this flag.
      sandbox: true,
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

    const report = await window.webContents.executeJavaScript(
      `(async () => {
        const workspaceRoot = ${JSON.stringify(desktopSmokeWorkspaceRoot ?? '')};
        const snapshotId = ${JSON.stringify(desktopSmokeSnapshotId)};
        const bridge = window.pbinfoDesktop;

        const headings = () =>
          Array.from(document.querySelectorAll('h1, h2'))
            .map((element) => element.textContent?.trim())
            .filter((value) => Boolean(value));

        const snapshot = () => ({
          headings: headings(),
          text: document.body?.innerText ?? '',
        });

        const pause = (timeoutMs) =>
          new Promise((resolve) => {
            setTimeout(resolve, timeoutMs);
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

        const clickAppSection = async (label) => {
          const button = Array.from(document.querySelectorAll('.view-switcher button[role="tab"]')).find(
            (element) => element.textContent?.includes(label),
          );

          if (!(button instanceof HTMLButtonElement)) {
            throw new Error('Desktop smoke probe could not find app section button: ' + label);
          }

          button.click();
          await pause(150);
        };

        const readDatasetButtons = () =>
          Array.from(document.querySelectorAll('.data-panel button[role="tab"]'))
            .map((element) => {
              const label =
                element.querySelector('span')?.textContent?.trim() ??
                element.textContent?.trim();
              return label;
            })
            .filter((value) => Boolean(value));

        const clickDatasetButton = async (label) => {
          const button = Array.from(document.querySelectorAll('.data-panel button[role="tab"]')).find(
            (element) => element.textContent?.includes(label),
          );

          if (!(button instanceof HTMLButtonElement)) {
            throw new Error('Desktop smoke probe could not find dataset button: ' + label);
          }

          button.click();
          await pause(150);
        };

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

        const inspectDataExplorer = async () => {
          if (!bridge) {
            throw new Error('Desktop smoke probe could not access the pbinfoDesktop bridge.');
          }

          await clickAppSection('Data');
          await waitFor(() => document.body?.innerText.includes('Data Explorer'));

          const summary = await bridge.getArchiveExplorerSummary(snapshotId);
          const datasetLabels = readDatasetButtons();
          const datasetListings = {};
          const visitedDatasets = [];

          for (const dataset of summary.datasets) {
            visitedDatasets.push(dataset.label);
            await clickDatasetButton(dataset.label);
            const listing = await bridge.listArchiveExplorerRecords({
              snapshotId,
              dataset: dataset.dataset,
              limit: 3,
            });
            const selectedRecordId = listing.items[0]?.recordId ?? null;
            const detail = selectedRecordId
              ? await bridge.getArchiveExplorerRecord({
                  snapshotId,
                  dataset: dataset.dataset,
                  recordId: selectedRecordId,
                })
              : null;

            datasetListings[dataset.dataset] = {
              totalCount: listing.totalCount,
              firstRecordId: selectedRecordId,
              detailTitle: detail?.title ?? null,
            };
          }

          await bridge.openPath(summary.normalizedRoot);
          await bridge.openPath(summary.mirrorRoot);
          await bridge.openExternal(summary.mirrorUrl);

          return {
            snapshotId,
            datasetLabels,
            visitedDatasets,
            datasetListings,
            summary,
          };
        };

        const inspectCoverageExplorer = async () => {
          if (!bridge) {
            throw new Error('Desktop smoke probe could not access the pbinfoDesktop bridge.');
          }

          await clickAppSection('Coverage');
          await waitFor(() => document.body?.innerText.includes('Coverage Explorer'));

          const summary = await bridge.getCoverageSummary(snapshotId);
          const listing = await bridge.listCoverageRecords({
            snapshotId,
            limit: 5,
          });
          const selectedProblemId = listing.items[0]?.problemId ?? null;
          const detail = selectedProblemId
            ? await bridge.getCoverageRecord({
                snapshotId,
                problemId: selectedProblemId,
              })
            : null;

          if (detail?.record.sourceListUrl) {
            await bridge.openExternal(detail.record.sourceListUrl);
          }

          return {
            summary,
            listing: {
              totalCount: listing.totalCount,
              firstProblemId: selectedProblemId,
              firstProblemName: listing.items[0]?.name ?? null,
            },
            detail: detail
              ? {
                  problemId: detail.record.problemId,
                  name: detail.record.name,
                  solvedByMe: detail.record.solvedByMe,
                  testsFragmentArchived: detail.record.testsFragmentArchived,
                  visibleTestsCapturedCount: detail.record.visibleTestsCapturedCount,
                  officialSourceArchived: detail.record.officialSourceArchived,
                  userSourceArchived: detail.record.userSourceArchived,
                  editorialAvailability: detail.record.editorialAvailability,
                }
              : null,
          };
        };

        return waitFor(() => document.body?.innerText.includes('Choose a workspace'))
          .then(() => {
            const initial = snapshot();

            if (!workspaceRoot) {
              return {
                initial,
                final: initial,
                dataExplorer: null,
                coverageExplorer: null,
              };
            }

            setWorkspaceAndSubmit(workspaceRoot);

            // Accept either the redesigned shell's Home view or the legacy
            // dashboard's "Archive Overview" heading so the smoke probe works
            // with either UI (legacy dashboard is still reachable via
            // PBINFO_DESKTOP_LEGACY_UI=1).
            return waitFor(
              () =>
                (document.body?.innerText.includes('Archive health') ?? false)
                || (document.body?.innerText.includes('Archive Overview') ?? false),
            )
              .then(async () => ({
                initial,
                final: snapshot(),
                dataExplorer: await inspectDataExplorer(),
                coverageExplorer: await inspectCoverageExplorer(),
              }));
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
