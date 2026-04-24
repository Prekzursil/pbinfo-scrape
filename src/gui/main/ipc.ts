import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  app,
  BrowserWindow,
  clipboard,
  nativeTheme,
  shell,
  type IpcMain,
} from 'electron';
import { z } from 'zod';

import { resolveArchiveRoot } from './archive-resolver.js';
import { readArchiveStore, writeArchiveStore } from './archive-store.js';
import { createDesktopController } from './desktop-controller.js';
import { loadProblemDetail } from './library-detail-repository.js';
import {
  collectTags,
  listProblems,
  loadProblemRowsFromSnapshot,
} from './library-repository.js';
import { openLiveSiteViewerChildWindow } from './live-site-viewer-window.js';
import { operatorLogin } from './login-coordinator.js';
import { createRunRefreshCoordinator } from './run-refresh-coordinator.js';
import {
  readDesktopPreferences,
  writeDesktopPreferences,
} from './desktop-preferences.js';
import type { NotificationService } from './notification-service.js';
import { createThemeBridge } from './theme-bridge.js';
import {
  activateWorkspaceProfile,
  deleteWorkspaceProfile,
  initializeWorkspaceState,
  readWorkspaceState,
  upsertWorkspaceProfile,
} from './workspace-store.js';
import {
  archiveSetManualOverrideInputSchema,
  guiArchiveDetailInputSchema,
  guiArchiveListInputSchema,
  guiArchiveSummaryInputSchema,
  guiCoverageDetailInputSchema,
  guiCoverageListInputSchema,
  guiCoverageSummaryInputSchema,
  desktopBrowserImportInputSchema,
  desktopCredentialLoginInputSchema,
  desktopPreferencesUpdateSchema,
  guiCrawlStatusInputSchema,
  guiJobEventsInputSchema,
  guiOpenPathInputSchema,
  guiJobStartInputSchema,
  guiOpenExternalInputSchema,
  guiWorkspaceSelectionSchema,
  libraryGetThemeResultSchema,
  librarySetThemeInputSchema,
  libraryDetailInputSchema,
  libraryListInputSchema,
  libraryTagsInputSchema,
} from '../shared/contracts.js';
import type { GuiArchiveState } from '../shared/types.js';

interface RegisterDesktopIpcOptions {
  ipcMain: Pick<IpcMain, 'handle'>;
  userDataRoot: string;
  notificationService?: NotificationService;
}

export function registerDesktopIpc(options: RegisterDesktopIpcOptions): void {
  let workspaceRoot = readDesktopPreferences(options.userDataRoot).workspaceRoot;
  let controller = workspaceRoot
    ? createDesktopController(workspaceRoot, {
        notificationService: options.notificationService,
      })
    : undefined;
  const desktopTestActionsPath = process.env.PBINFO_DESKTOP_TEST_ACTIONS_PATH;
  const desktopTestDryRunOpeners =
    process.env.PBINFO_DESKTOP_TEST_DRY_RUN_OPENERS === '1';

  options.ipcMain.handle('desktop:workspace:state', async () => {
    if (!workspaceRoot) {
      return null;
    }
    return readWorkspaceState(workspaceRoot);
  });

  options.ipcMain.handle('desktop:preferences:get', async () =>
    readDesktopPreferences(options.userDataRoot),
  );

  options.ipcMain.handle('desktop:preferences:set', async (_event, payload) => {
    const parsed = desktopPreferencesUpdateSchema.parse(payload);
    const current = readDesktopPreferences(options.userDataRoot);
    return writeDesktopPreferences(options.userDataRoot, {
      ...current,
      verbosityMode: parsed.verbosityMode,
    });
  });

  options.ipcMain.handle('desktop:workspace:select', async (_event, payload) => {
    const parsed = guiWorkspaceSelectionSchema.parse(payload);
    workspaceRoot = parsed.workspaceRoot;
    initializeWorkspaceState(workspaceRoot);
    controller = createDesktopController(workspaceRoot, {
      notificationService: options.notificationService,
    });
    const currentPreferences = readDesktopPreferences(options.userDataRoot);
    writeDesktopPreferences(options.userDataRoot, {
      ...currentPreferences,
      workspaceRoot,
    });
    return readWorkspaceState(workspaceRoot);
  });

  options.ipcMain.handle('desktop:profiles:create', async (_event, payload) => {
    assertWorkspaceSelected(workspaceRoot);
    return upsertWorkspaceProfile(workspaceRoot, payload);
  });

  options.ipcMain.handle('desktop:profiles:activate', async (_event, payload) => {
    assertWorkspaceSelected(workspaceRoot);
    return activateWorkspaceProfile(workspaceRoot, asProfileId(payload));
  });

  options.ipcMain.handle('desktop:profiles:delete', async (_event, payload) => {
    assertWorkspaceSelected(workspaceRoot);
    return deleteWorkspaceProfile(workspaceRoot, asProfileId(payload));
  });

  options.ipcMain.handle('desktop:archive:summary', async (_event, payload) => {
    assertController(controller);
    const parsed = guiArchiveSummaryInputSchema.parse(payload ?? {});
    return controller.getArchiveExplorerSummary(parsed.snapshotId);
  });

  options.ipcMain.handle('desktop:archive:list', async (_event, payload) => {
    assertController(controller);
    const parsed = guiArchiveListInputSchema.parse(payload);
    return controller.listArchiveExplorerRecords(parsed);
  });

  options.ipcMain.handle('desktop:archive:detail', async (_event, payload) => {
    assertController(controller);
    const parsed = guiArchiveDetailInputSchema.parse(payload);
    return controller.getArchiveExplorerRecord(parsed);
  });
  options.ipcMain.handle('desktop:coverage:summary', async (_event, payload) => {
    assertController(controller);
    const parsed = guiCoverageSummaryInputSchema.parse(payload ?? {});
    return controller.getCoverageSummary(parsed.snapshotId);
  });
  options.ipcMain.handle('desktop:coverage:list', async (_event, payload) => {
    assertController(controller);
    const parsed = guiCoverageListInputSchema.parse(payload ?? {});
    return controller.listCoverageRecords(parsed);
  });
  options.ipcMain.handle('desktop:coverage:detail', async (_event, payload) => {
    assertController(controller);
    const parsed = guiCoverageDetailInputSchema.parse(payload);
    return controller.getCoverageRecord(parsed);
  });

  options.ipcMain.handle('desktop:auth:login', async (_event, payload) => {
    assertController(controller);
    return controller.loginProfile(desktopCredentialLoginInputSchema.parse(payload));
  });

  options.ipcMain.handle('desktop:auth:import-browser', async (_event, payload) => {
    assertController(controller);
    return controller.importBrowserProfile(desktopBrowserImportInputSchema.parse(payload));
  });

  options.ipcMain.handle('desktop:jobs:list', async () => {
    if (!controller) {
      return [];
    }
    return controller.listJobs();
  });
  options.ipcMain.handle('desktop:jobs:events', async (_event, payload) => {
    assertController(controller);
    const parsed = guiJobEventsInputSchema.parse(payload);
    return controller.listJobEvents(parsed.jobId, parsed.limit);
  });
  options.ipcMain.handle('desktop:crawl:status', async (_event, payload) => {
    assertController(controller);
    const parsed = guiCrawlStatusInputSchema.parse(payload ?? {});
    return controller.getCrawlStatus(parsed.snapshotId);
  });
  options.ipcMain.handle('desktop:external:open', async (_event, payload) => {
    const parsed = guiOpenExternalInputSchema.parse(payload);
    recordDesktopTestAction(desktopTestActionsPath, {
      kind: 'openExternal',
      target: parsed.url,
    });
    if (desktopTestDryRunOpeners) {
      return;
    }
    await shell.openExternal(parsed.url);
  });
  options.ipcMain.handle('desktop:path:open', async (_event, payload) => {
    const parsed = guiOpenPathInputSchema.parse(payload);
    recordDesktopTestAction(desktopTestActionsPath, {
      kind: 'openPath',
      target: parsed.path,
    });
    if (desktopTestDryRunOpeners) {
      return;
    }
    const errorMessage = await shell.openPath(parsed.path);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });

  const registry = createDesktopIpcRegistry({
    startJob: async (payload) => {
      assertController(controller);
      return controller.startJob(payload);
    },
    resumeJob: async (jobId, input) => {
      assertController(controller);
      return controller.resumeJob(jobId, input);
    },
    pauseJob: async (jobId) => {
      assertController(controller);
      return controller.pauseJob(jobId);
    },
    startMirrorPreview: async (snapshotId, input) => {
      assertController(controller);
      return controller.startMirrorPreview(snapshotId, input);
    },
    stopMirrorPreview: async (jobId) => {
      assertController(controller);
      return controller.stopMirrorPreview(jobId);
    },
  });

  options.ipcMain.handle('desktop:jobs:start', async (_event, payload) =>
    registry['desktop:jobs:start'](payload),
  );
  options.ipcMain.handle('desktop:jobs:pause', async (_event, payload) =>
    registry['desktop:jobs:pause'](payload),
  );
  options.ipcMain.handle('desktop:jobs:resume', async (_event, payload) =>
    registry['desktop:jobs:resume'](payload),
  );
  options.ipcMain.handle('desktop:mirror:start-preview', async (_event, payload) =>
    registry['desktop:mirror:start-preview'](payload),
  );
  options.ipcMain.handle('desktop:mirror:stop-preview', async (_event, payload) =>
    registry['desktop:mirror:stop-preview'](payload),
  );

  // Library browser redesign (2026-04-23): archive state + manual override.
  const resolveArchiveState = (
    override: string | undefined,
  ): GuiArchiveState => {
    let exePath: string | undefined;
    try {
      exePath = app.getPath('exe');
    } catch {
      exePath = undefined;
    }
    const exeDir =
      typeof exePath === 'string' && exePath.length > 0
        ? dirname(exePath)
        : process.cwd();
    const probe = resolveArchiveRoot({
      exeDir,
      cwd: process.cwd(),
      manualOverride: override,
    });
    return {
      ...probe,
      catalogSnapshots: loadCatalogSnapshots(probe.archiveRoot),
    };
  };

  options.ipcMain.handle('archive:state', async () => {
    try {
      const store = readArchiveStore(options.userDataRoot);
      return resolveArchiveState(store.manualArchiveOverride);
    } catch (error) {
      // Defensive: any crash inside archive probing should surface as a
      // not-found state with the error in probedPaths, so the renderer can
      // show a helpful empty-state instead of hanging.
      const message = error instanceof Error ? error.message : String(error);
      const fallback: GuiArchiveState = {
        found: false,
        probedPaths: [`<archive:state crashed: ${message}>`],
      };
      return fallback;
    }
  });

  options.ipcMain.handle(
    'archive:set-manual-override',
    async (_event, payload: unknown) => {
      const { absolutePath } =
        archiveSetManualOverrideInputSchema.parse(payload);
      writeArchiveStore(options.userDataRoot, {
        manualArchiveOverride: absolutePath,
      });
      return resolveArchiveState(absolutePath);
    },
  );

  // Library browser redesign (2026-04-23): theme IPC bridge.
  const themeBridge = createThemeBridge({
    nativeTheme,
    getPreference: () =>
      readDesktopPreferences(options.userDataRoot).themePreference ?? 'auto',
    setPreference: (preference) => {
      const current = readDesktopPreferences(options.userDataRoot);
      writeDesktopPreferences(options.userDataRoot, {
        ...current,
        themePreference: preference,
      });
    },
    broadcast: ({ effective }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('theme:changed', { effective });
      }
    },
  });

  options.ipcMain.handle('library:theme:get', async () =>
    libraryGetThemeResultSchema.parse(themeBridge.getTheme()),
  );
  options.ipcMain.handle(
    'library:theme:set',
    async (_event, payload: unknown) => {
      const input = librarySetThemeInputSchema.parse(payload);
      return libraryGetThemeResultSchema.parse(themeBridge.setTheme(input));
    },
  );

  options.ipcMain.handle(
    'library:problems:list',
    async (_event, payload: unknown) => {
      const input = libraryListInputSchema.parse(payload);
      const archive = resolveArchiveState(
        readArchiveStore(options.userDataRoot).manualArchiveOverride,
      );
      if (!archive.found || !archive.archiveRoot) {
        return {
          totalCount: 0,
          rows: [],
          snapshotId: input.snapshotId ?? archive.snapshotId,
        };
      }
      const snapshotId = input.snapshotId ?? archive.snapshotId;
      if (!snapshotId) {
        return { totalCount: 0, rows: [], snapshotId: undefined };
      }
      const rows = loadProblemRowsFromSnapshot(archive.archiveRoot, snapshotId);
      const result = listProblems({
        rows,
        filters: input.filters,
        sort: input.sort,
        limit: input.limit,
        offset: input.offset,
      });
      return { ...result, snapshotId };
    },
  );

  options.ipcMain.handle(
    'library:tags',
    async (_event, payload: unknown) => {
      const input = libraryTagsInputSchema.parse(payload);
      const archive = resolveArchiveState(
        readArchiveStore(options.userDataRoot).manualArchiveOverride,
      );
      if (!archive.found || !archive.archiveRoot) return [];
      const snapshotId = input.snapshotId ?? archive.snapshotId;
      if (!snapshotId) return [];
      const rows = loadProblemRowsFromSnapshot(archive.archiveRoot, snapshotId);
      return collectTags(rows);
    },
  );

  options.ipcMain.handle(
    'library:problems:detail',
    async (_event, payload: unknown) => {
      const input = libraryDetailInputSchema.parse(payload);
      const archive = resolveArchiveState(
        readArchiveStore(options.userDataRoot).manualArchiveOverride,
      );
      if (!archive.found || !archive.archiveRoot) {
        throw new Error('archive-missing');
      }
      const snapshotId = input.snapshotId ?? archive.snapshotId;
      if (!snapshotId) {
        throw new Error('snapshot-missing');
      }
      return loadProblemDetail(
        archive.archiveRoot,
        snapshotId,
        input.problemId,
      );
    },
  );

  const shellOpenPathSchema = z
    .object({ path: z.string().min(1).max(4096) })
    .strict();
  options.ipcMain.handle(
    'shell:open-path',
    async (_event, payload: unknown) => {
      const { path: p } = shellOpenPathSchema.parse(payload);
      return shell.openPath(p);
    },
  );

  const shellCopySchema = z
    .object({ text: z.string().max(1_000_000) })
    .strict();
  options.ipcMain.handle(
    'shell:copy-to-clipboard',
    async (_event, payload: unknown) => {
      const { text } = shellCopySchema.parse(payload);
      clipboard.writeText(text);
      return { ok: true };
    },
  );

  // ─── Operator pipeline (Task 8) ───────────────────────────────────────────

  const broadcastToAllWindows = (channel: string, payload: unknown): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(channel, payload);
    }
  };

  const coordinator = createRunRefreshCoordinator({
    runPipeline: async () => {
      // NOTE: the real pipeline wiring lives in the CLI / workflow modules.
      // Wiring the run-full-refresh execution into this coordinator is a
      // follow-up: it should shell out to `runCrawlWorkflow` and friends,
      // forwarding progress via onProgress. For now this handler is the
      // integration seam — it returns the resolved archive state unchanged
      // so the coordinator's broadcast + archive:changed plumbing can be
      // exercised manually from the UI without kicking off a real 4-5h
      // crawl. Task 11 wires the real pipeline.
      const archive = resolveArchiveState(
        readArchiveStore(options.userDataRoot).manualArchiveOverride,
      );
      if (!archive.found || !archive.archiveRoot || !archive.snapshotId) {
        throw new Error('archive-missing');
      }
      return {
        archiveRoot: archive.archiveRoot,
        snapshotId: archive.snapshotId,
      };
    },
    broadcast: (event) =>
      broadcastToAllWindows('operator:run-full-refresh:progress', event),
    broadcastArchiveChanged: (event) =>
      broadcastToAllWindows('archive:changed', event),
  });

  const runRefreshInputSchema = z
    .object({ snapshotLabel: z.string().max(64).optional() })
    .strict();
  options.ipcMain.handle(
    'operator:run-full-refresh',
    async (_event, payload: unknown) => {
      const input = runRefreshInputSchema.parse(payload);
      const { jobId } = coordinator.start(input);
      return { jobId };
    },
  );

  const cancelRefreshInputSchema = z
    .object({ jobId: z.string().min(1).max(128) })
    .strict();
  options.ipcMain.handle(
    'operator:run-full-refresh:cancel',
    async (_event, payload: unknown) => {
      const input = cancelRefreshInputSchema.parse(payload);
      return coordinator.cancel(input);
    },
  );

  const operatorLoginInputSchema = z
    .object({
      username: z.string().min(1).max(64),
      password: z.string().min(1).max(256),
    })
    .strict();
  options.ipcMain.handle(
    'operator:login',
    async (_event, payload: unknown) => {
      try {
        const input = operatorLoginInputSchema.parse(payload);
        const archive = resolveArchiveState(
          readArchiveStore(options.userDataRoot).manualArchiveOverride,
        );
        if (!archive.found || !archive.archiveRoot) {
          throw new Error('archive-missing');
        }
        return await operatorLogin(archive.archiveRoot, input);
      } catch (error) {
        // MUST NOT log the payload; only the error code + message.
        const code = (error as { code?: string }).code;
        const message =
          error instanceof Error ? error.message : 'unknown';
        console.error('operator:login failed', { code, message });
        throw new Error('login-failed');
      }
    },
  );

  const openLiveSiteInputSchema = z
    .object({ problemId: z.string().max(32).optional() })
    .strict();
  options.ipcMain.handle(
    'operator:open-live-site-viewer',
    async (_event, payload: unknown) => {
      const input = openLiveSiteInputSchema.parse(payload);
      return openLiveSiteViewerChildWindow(input);
    },
  );
}

function loadCatalogSnapshots(
  archiveRoot: string | undefined,
): GuiArchiveState['catalogSnapshots'] {
  if (!archiveRoot) return undefined;
  const catalogPath = join(archiveRoot, 'catalog.json');
  if (!existsSync(catalogPath)) return undefined;
  try {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      snapshots?: Array<{
        id: string;
        status?: string;
        createdAt?: string;
        label?: string;
      }>;
    };
    return (catalog.snapshots ?? []).map((s) => ({
      id: s.id,
      status: s.status ?? 'unknown',
      createdAt: s.createdAt,
      label: s.label,
    }));
  } catch {
    return undefined;
  }
}

export function createDesktopIpcRegistry(handlers: {
  startJob: (payload: ReturnType<typeof guiJobStartInputSchema.parse>) => Promise<unknown>;
  resumeJob: (jobId: string, options?: { maxIterations?: number }) => Promise<unknown>;
  pauseJob: (jobId: string) => Promise<unknown> | unknown;
  startMirrorPreview: (snapshotId: string, options?: { port?: number }) => Promise<unknown>;
  stopMirrorPreview: (jobId: string) => Promise<unknown>;
}) {
  return {
    async 'desktop:jobs:start'(payload: unknown) {
      return handlers.startJob(guiJobStartInputSchema.parse(payload));
    },
    async 'desktop:jobs:pause'(payload: unknown) {
      return handlers.pauseJob(asJobId(payload));
    },
    async 'desktop:jobs:resume'(payload: unknown) {
      const input = payload as { maxIterations?: number };
      return handlers.resumeJob(asJobId(payload), {
        maxIterations: input.maxIterations,
      });
    },
    async 'desktop:mirror:start-preview'(payload: unknown) {
      const input = payload as {
        snapshotId?: string;
        port?: number;
      };
      if (!input.snapshotId) {
        throw new Error('snapshotId is required.');
      }
      return handlers.startMirrorPreview(input.snapshotId, {
        port: input.port,
      });
    },
    async 'desktop:mirror:stop-preview'(payload: unknown) {
      return handlers.stopMirrorPreview(asJobId(payload));
    },
  };
}

function recordDesktopTestAction(
  actionsPath: string | undefined,
  action: {
    kind: 'openPath' | 'openExternal';
    target: string;
  },
): void {
  if (!actionsPath) {
    return;
  }

  const existing = existsSync(actionsPath)
    ? (JSON.parse(readFileSync(actionsPath, 'utf8')) as Array<{
        kind: 'openPath' | 'openExternal';
        target: string;
      }>)
    : [];

  mkdirSync(dirname(actionsPath), {
    recursive: true,
  });
  existing.push(action);
  writeFileSync(actionsPath, JSON.stringify(existing, null, 2), 'utf8');
}

function assertWorkspaceSelected(
  workspaceRoot: string | undefined,
): asserts workspaceRoot is string {
  if (!workspaceRoot) {
    throw new Error('No desktop workspace has been selected yet.');
  }
}

function assertController(
  controller: ReturnType<typeof createDesktopController> | undefined,
): asserts controller is ReturnType<typeof createDesktopController> {
  if (!controller) {
    throw new Error('The desktop controller is not ready because no workspace is selected.');
  }
}

function asProfileId(payload: unknown): string {
  const profileId = (payload as { profileId?: string })?.profileId;
  if (!profileId) {
    throw new Error('profileId is required.');
  }
  return profileId;
}

function asJobId(payload: unknown): string {
  const jobId = (payload as { jobId?: string })?.jobId;
  if (!jobId) {
    throw new Error('jobId is required.');
  }
  return jobId;
}
