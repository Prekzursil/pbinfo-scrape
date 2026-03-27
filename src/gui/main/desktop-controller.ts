import { randomUUID } from 'node:crypto';

import {
  type GuiArchiveDetailInput,
  type GuiArchiveListInput,
  type GuiCoverageDetailInput,
  type GuiCoverageListInput,
  guiCrawlJobDetailSchema,
  guiJobStartInputSchema,
} from '../shared/contracts.js';
import type {
  GuiArchiveListing,
  GuiArchiveRecordDetail,
  GuiArchiveSummary,
  GuiCoverageDetail,
  GuiCoverageListing,
  GuiCoverageSummary,
  GuiCrawlMode,
  GuiCrawlStatus,
  GuiJobEvent,
  GuiJobRecord,
  GuiProfileRecord,
  GuiWorkspaceState,
} from '../shared/types.js';
import {
  getArchiveExplorerSummary,
  listArchiveExplorerRecords,
  readArchiveExplorerRecord,
} from './archive-data-explorer.js';
import {
  getCoverageExplorerSummary,
  listCoverageExplorerRecords,
  readCoverageExplorerRecord,
} from './problem-coverage-explorer.js';
import {
  appendGuiJobEvent,
  createGuiJob,
  listGuiJobs,
  readGuiJob,
  readGuiJobEvents,
  recoverInterruptedGuiJobs,
  updateGuiJob,
} from './job-store.js';
import {
  type DesktopNotification,
  type NotificationService,
  noopNotificationService,
} from './notification-service.js';
import { importBrowserCookies, type SupportedChromiumBrowser } from '../../auth/cookie-import.js';
import { PbinfoAuthClient } from '../../auth/pbinfo-auth.js';
import { loadLocalConfig } from '../../config/local-config.js';
import { buildMirrorArtifacts } from '../../mirror/build-mirror.js';
import {
  startMirrorServer,
  type RunningMirrorServer,
} from '../../mirror/server.js';
import {
  getCrawlStatusWorkflow,
  resumeCrawlWorkflow,
  runCrawlWorkflow,
  type CrawlStatusResult,
  type CrawlWorkflowResult,
} from '../../workflows/crawl-workflow.js';
import { runNormalizeSnapshotWorkflow } from '../../workflows/normalize-workflow.js';
import { runRankingWorkflow } from '../../workflows/rank-workflow.js';
import { runProblemCoverageWorkflow } from '../../workflows/problem-coverage-workflow.js';
import { finalizeSnapshotWorkflow } from '../../workflows/snapshot-workflow.js';
import { upsertAndActivateWorkspaceProfile } from './workspace-store.js';

export type NotificationMessage = DesktopNotification;

export interface DesktopControllerDependencies {
  runCrawlWorkflow: typeof runCrawlWorkflow;
  resumeCrawlWorkflow: typeof resumeCrawlWorkflow;
  getCrawlStatusWorkflow: typeof getCrawlStatusWorkflow;
  runNormalizeSnapshotWorkflow: typeof runNormalizeSnapshotWorkflow;
  runRankingWorkflow: typeof runRankingWorkflow;
  runProblemCoverageWorkflow: typeof runProblemCoverageWorkflow;
  buildMirrorArtifacts: typeof buildMirrorArtifacts;
  finalizeSnapshotWorkflow: typeof finalizeSnapshotWorkflow;
  startMirrorServer: typeof startMirrorServer;
  importBrowserCookies: typeof importBrowserCookies;
  createAuthClient: (options: {
    baseUrl: string;
    sessionCookiesPath: string;
  }) => PbinfoAuthClient;
  getArchiveExplorerSummary: typeof getArchiveExplorerSummary;
  listArchiveExplorerRecords: typeof listArchiveExplorerRecords;
  readArchiveExplorerRecord: typeof readArchiveExplorerRecord;
  getCoverageExplorerSummary: typeof getCoverageExplorerSummary;
  listCoverageExplorerRecords: typeof listCoverageExplorerRecords;
  readCoverageExplorerRecord: typeof readCoverageExplorerRecord;
  loadLocalConfig: typeof loadLocalConfig;
  notificationService: NotificationService;
}

export interface StartDesktopJobInput {
  kind: 'crawl' | 'normalize' | 'rank' | 'mirror-build' | 'snapshot-finalize';
  snapshotId?: string;
  profileId?: string;
  detail?: {
    scope?: 'public' | 'user' | 'all';
    mode?: GuiCrawlMode;
    [key: string]: unknown;
  };
  maxIterations?: number;
  now?: Date;
}

export interface ResumeDesktopJobOptions {
  maxIterations?: number;
  now?: Date;
}

export interface LoginDesktopProfileInput {
  profileId: string;
  label: string;
  userHandle?: string;
  username: string;
  password: string;
  encryptedBundlePath?: string;
  now?: Date;
}

export interface ImportBrowserDesktopProfileInput {
  profileId: string;
  label: string;
  userHandle?: string;
  browser: SupportedChromiumBrowser;
  profileName?: string;
  userDataDir?: string;
  encryptedBundlePath?: string;
  now?: Date;
}

export interface DesktopAuthJobResult {
  profile: GuiProfileRecord;
  workspaceState: GuiWorkspaceState;
  job: GuiJobRecord;
}

type ProfileCookie = {
  key: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string | number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

type SerializedSessionCookie = {
  key?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: string | number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

export interface StartMirrorPreviewOptions {
  port?: number;
}

export interface MirrorPreviewHandle {
  job: GuiJobRecord;
  baseUrl: string;
}

export interface DesktopController {
  listJobs(): GuiJobRecord[];
  getJob(jobId: string): GuiJobRecord;
  listJobEvents(jobId: string, limit?: number): GuiJobEvent[];
  getArchiveExplorerSummary(snapshotId?: string): GuiArchiveSummary;
  listArchiveExplorerRecords(input: GuiArchiveListInput): GuiArchiveListing;
  getArchiveExplorerRecord(input: GuiArchiveDetailInput): GuiArchiveRecordDetail;
  getCoverageSummary(snapshotId?: string): Promise<GuiCoverageSummary>;
  listCoverageRecords(input: GuiCoverageListInput): Promise<GuiCoverageListing>;
  getCoverageRecord(input: GuiCoverageDetailInput): Promise<GuiCoverageDetail>;
  getCrawlStatus(snapshotId?: string): GuiCrawlStatus | null;
  recoverInterruptedJobs(options?: { now?: Date }): GuiJobRecord[];
  pauseJob(jobId: string, options?: { now?: Date }): GuiJobRecord;
  loginProfile(input: LoginDesktopProfileInput): Promise<DesktopAuthJobResult>;
  importBrowserProfile(input: ImportBrowserDesktopProfileInput): Promise<DesktopAuthJobResult>;
  startJob(input: StartDesktopJobInput): Promise<GuiJobRecord>;
  resumeJob(jobId: string, options?: ResumeDesktopJobOptions): Promise<GuiJobRecord>;
  startMirrorPreview(snapshotId: string, options?: StartMirrorPreviewOptions): Promise<MirrorPreviewHandle>;
  stopMirrorPreview(jobId: string): Promise<GuiJobRecord>;
}

export function createDesktopController(
  workspaceRoot: string,
  overrides: Partial<DesktopControllerDependencies> = {},
): DesktopController {
  const dependencies: DesktopControllerDependencies = {
    runCrawlWorkflow,
    resumeCrawlWorkflow,
    getCrawlStatusWorkflow,
    runNormalizeSnapshotWorkflow,
    runRankingWorkflow,
    runProblemCoverageWorkflow,
    buildMirrorArtifacts,
    finalizeSnapshotWorkflow,
    startMirrorServer,
    importBrowserCookies,
    createAuthClient: (options) => new PbinfoAuthClient(options),
    getArchiveExplorerSummary,
    listArchiveExplorerRecords,
    readArchiveExplorerRecord,
    getCoverageExplorerSummary,
    listCoverageExplorerRecords,
    readCoverageExplorerRecord,
    loadLocalConfig,
    notificationService: noopNotificationService,
    ...overrides,
  };
  const runningMirrors = new Map<string, RunningMirrorServer>();
  const coverageRefreshes = new Map<string, Promise<void>>();

  return {
    listJobs() {
      return listGuiJobs(workspaceRoot);
    },

    getJob(jobId) {
      return readGuiJob(workspaceRoot, jobId);
    },

    listJobEvents(jobId, limit) {
      return readGuiJobEvents(workspaceRoot, jobId, limit);
    },

    getArchiveExplorerSummary(snapshotId) {
      return dependencies.getArchiveExplorerSummary(workspaceRoot, {
        snapshotId,
      });
    },

    listArchiveExplorerRecords(input) {
      return dependencies.listArchiveExplorerRecords(workspaceRoot, input);
    },

    getArchiveExplorerRecord(input) {
      return dependencies.readArchiveExplorerRecord(workspaceRoot, input);
    },

    async getCoverageSummary(snapshotId) {
      return readCoverageExplorerWithRebuild(() =>
        dependencies.getCoverageExplorerSummary(workspaceRoot, {
          snapshotId,
        }), snapshotId);
    },

    async listCoverageRecords(input) {
      return readCoverageExplorerWithRebuild(() =>
        dependencies.listCoverageExplorerRecords(workspaceRoot, input), input.snapshotId);
    },

    async getCoverageRecord(input) {
      return readCoverageExplorerWithRebuild(() =>
        dependencies.readCoverageExplorerRecord(workspaceRoot, input), input.snapshotId);
    },

    getCrawlStatus(snapshotId) {
      try {
        return dependencies.getCrawlStatusWorkflow(workspaceRoot, snapshotId);
      } catch (error) {
        if (error instanceof Error && error.message.includes('was not found in archive/catalog.json')) {
          return null;
        }

        throw error;
      }
    },

    recoverInterruptedJobs(options = {}) {
      return recoverInterruptedGuiJobs(workspaceRoot, options);
    },

    pauseJob(jobId, options = {}) {
      appendGuiJobEvent(workspaceRoot, jobId, {
        timestamp: iso(options.now),
        level: 'info',
        stage: 'crawl-pause',
        message: 'Pause requested. The crawler will stop after the current chunk completes.',
      });
      return updateGuiJob(workspaceRoot, jobId, {
        status: 'paused',
        resumable: true,
        updatedAt: iso(options.now),
      });
    },

    async loginProfile(input) {
      const job = createGuiJob(workspaceRoot, {
        jobId: randomUUID(),
        kind: 'auth-login',
        profileId: input.profileId,
        detail: {
          label: input.label,
          userHandle: input.userHandle,
        },
        now: input.now,
      });
      updateGuiJob(workspaceRoot, job.jobId, {
        status: 'running',
        updatedAt: iso(input.now),
      });

      try {
        const config = dependencies.loadLocalConfig(workspaceRoot);
        const authClient = dependencies.createAuthClient({
          baseUrl: 'https://www.pbinfo.ro/',
          sessionCookiesPath: config.auth.sessionCookiesPath,
        });
        const result = await authClient.loginWithCredentials({
          username: input.username,
          password: input.password,
          persistSessionCookies: false,
        });
        if (!result.success) {
          throw new Error(
            result.failureReason
            ?? 'PBInfo credential login did not produce an authenticated session.',
          );
        }

        const activation = upsertAndActivateWorkspaceProfile(workspaceRoot, {
          profileId: input.profileId,
          label: input.label,
          userHandle: input.userHandle,
          provenance: {
            type: 'login',
          },
          sessionCookies: normalizePersistedCookiesForProfile(result.sessionCookies),
          encryptedBundlePath: input.encryptedBundlePath,
          now: input.now,
        });
        appendGuiJobEvent(workspaceRoot, job.jobId, {
          timestamp: iso(input.now),
          level: 'info',
          stage: 'auth-login',
          message: `Signed in and activated profile ${input.profileId}`,
          detail: {
            redirectUrl: result.redirectUrl,
          },
        });
        const completed = updateGuiJob(workspaceRoot, job.jobId, {
          status: 'completed',
          updatedAt: iso(input.now),
          detail: {
            redirectUrl: result.redirectUrl,
          },
        });
        await dependencies.notificationService.notify({
          level: 'info',
          title: 'PBInfo login complete',
          message: input.label,
        });
        return {
          profile: activation.profile,
          workspaceState: activation.workspaceState,
          job: completed,
        };
      } catch (error) {
        return failAuthJob(job.jobId, 'auth-login', input.label, error, input.now);
      }
    },

    async importBrowserProfile(input) {
      const job = createGuiJob(workspaceRoot, {
        jobId: randomUUID(),
        kind: 'auth-import-browser',
        profileId: input.profileId,
        detail: {
          label: input.label,
          browser: input.browser,
          profileName: input.profileName,
          userHandle: input.userHandle,
        },
        now: input.now,
      });
      updateGuiJob(workspaceRoot, job.jobId, {
        status: 'running',
        updatedAt: iso(input.now),
      });

      try {
        const imported = await dependencies.importBrowserCookies({
          browser: input.browser,
          profile: input.profileName,
          userDataDir: input.userDataDir,
        });
        const activation = upsertAndActivateWorkspaceProfile(workspaceRoot, {
          profileId: input.profileId,
          label: input.label,
          userHandle: input.userHandle,
          provenance: {
            type: 'browser-import',
            browser: input.browser,
          },
          sessionCookies: imported.map(mapImportedCookieToPersisted),
          encryptedBundlePath: input.encryptedBundlePath,
          now: input.now,
        });
        appendGuiJobEvent(workspaceRoot, job.jobId, {
          timestamp: iso(input.now),
          level: 'info',
          stage: 'auth-import-browser',
          message: `Imported ${imported.length} cookies and activated profile ${input.profileId}`,
          detail: {
            browser: input.browser,
            profileName: input.profileName ?? 'Default',
            imported: imported.length,
          },
        });
        const completed = updateGuiJob(workspaceRoot, job.jobId, {
          status: 'completed',
          updatedAt: iso(input.now),
          detail: {
            browser: input.browser,
            imported: imported.length,
          },
        });
        await dependencies.notificationService.notify({
          level: 'info',
          title: 'Browser session imported',
          message: input.label,
        });
        return {
          profile: activation.profile,
          workspaceState: activation.workspaceState,
          job: completed,
        };
      } catch (error) {
        return failAuthJob(
          job.jobId,
          'auth-import-browser',
          input.label,
          error,
          input.now,
        );
      }
    },

    async startJob(input) {
      const { maxIterations, now, ...rawStart } = input;
      const parsed = guiJobStartInputSchema.parse(rawStart);
      switch (parsed.kind) {
        case 'crawl':
          return runCrawlChunk({
            jobId: randomUUID(),
            detail: parsed.detail,
            profileId: parsed.profileId,
            requestedSnapshotId: parsed.snapshotId,
            maxIterations,
            now,
          });
        case 'normalize':
          return runNormalizeJob(parsed.snapshotId, now);
        case 'rank':
          return runRankingJob(parsed.snapshotId, now);
        case 'mirror-build':
          return runMirrorBuildJob(parsed.snapshotId, now);
        case 'snapshot-finalize':
          if (!parsed.snapshotId) {
            throw new Error('snapshot-finalize jobs require a snapshotId.');
          }
          return runFinalizeJob(parsed.snapshotId, now);
        default:
          throw new Error(`Unsupported desktop job kind: ${parsed.kind satisfies never}`);
      }
    },

    async resumeJob(jobId, options = {}) {
      const current = readGuiJob(workspaceRoot, jobId);
      if (current.kind !== 'crawl') {
        throw new Error(`Desktop job "${jobId}" is not resumable.`);
      }

      return runCrawlChunk({
        jobId,
        detail: current.detail,
        profileId: current.profileId,
        requestedSnapshotId: current.snapshotId,
        maxIterations: options.maxIterations,
        now: options.now,
        resume: true,
      });
    },

    async startMirrorPreview(snapshotId, options = {}) {
      const created = createGuiJob(workspaceRoot, {
        jobId: randomUUID(),
        kind: 'mirror-serve',
        snapshotId,
        now: new Date(),
      });
      updateGuiJob(workspaceRoot, created.jobId, {
        status: 'running',
        resumable: false,
      });

      try {
        const running = await dependencies.startMirrorServer({
          workspaceRoot,
          snapshotId,
          port: options.port ?? 0,
        });
        runningMirrors.set(created.jobId, running);
        const updated = appendGuiJobEvent(workspaceRoot, created.jobId, {
          timestamp: new Date().toISOString(),
          level: 'info',
          stage: 'mirror-preview',
          message: `Mirror preview ready at ${running.baseUrl}`,
          detail: {
            baseUrl: running.baseUrl,
            mirrorPreviewUrl: running.baseUrl,
          },
        });
        await dependencies.notificationService.notify({
          level: 'info',
          title: 'Mirror preview ready',
          message: running.baseUrl,
        });
        return {
          job: updated,
          baseUrl: running.baseUrl,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendGuiJobEvent(workspaceRoot, created.jobId, {
          timestamp: new Date().toISOString(),
          level: 'error',
          stage: 'mirror-preview',
          message,
          detail: {
            error: message,
          },
        });
        updateGuiJob(workspaceRoot, created.jobId, {
          status: 'failed',
          updatedAt: new Date().toISOString(),
          detail: {
            ...(safeReadJob(created.jobId)?.detail ?? {}),
            error: message,
          },
        });
        await dependencies.notificationService.notify({
          level: 'error',
          title: 'Mirror preview failed',
          message,
        });
        throw error;
      }
    },

    async stopMirrorPreview(jobId) {
      const running = runningMirrors.get(jobId);
      if (!running) {
        throw new Error(`Mirror preview job "${jobId}" is not active.`);
      }

      await running.close();
      runningMirrors.delete(jobId);
      appendGuiJobEvent(workspaceRoot, jobId, {
        timestamp: new Date().toISOString(),
        level: 'info',
        stage: 'mirror-preview',
        message: 'Mirror preview stopped',
      });
      return updateGuiJob(workspaceRoot, jobId, {
        status: 'completed',
      });
    },
  };

  async function runCrawlChunk(options: {
    jobId: string;
    detail?: {
      scope?: 'public' | 'user' | 'all';
      mode?: GuiCrawlMode;
      [key: string]: unknown;
    };
    profileId?: string;
    requestedSnapshotId?: string;
    maxIterations?: number;
    now?: Date;
    resume?: boolean;
  }): Promise<GuiJobRecord> {
    const job =
      safeReadJob(options.jobId) ??
      createGuiJob(workspaceRoot, {
        jobId: options.jobId,
        kind: 'crawl',
        profileId: options.profileId,
        snapshotId: options.requestedSnapshotId,
        detail: options.detail,
        now: options.now,
      });

    updateGuiJob(workspaceRoot, job.jobId, {
      status: 'running',
      resumable: true,
      updatedAt: iso(options.now),
    });

    const crawlDetail = resolveCrawlDetail(options.detail);
    const result = options.resume
      ? await dependencies.resumeCrawlWorkflow(workspaceRoot, {
          maxIterations: options.maxIterations,
          now: options.now,
          snapshotId: job.snapshotId,
        })
      : await dependencies.runCrawlWorkflow(workspaceRoot, crawlDetail.scope, {
          snapshotId: options.requestedSnapshotId,
          maxIterations: options.maxIterations,
          now: options.now,
          mode: crawlDetail.mode,
        });
    const status = dependencies.getCrawlStatusWorkflow(
      workspaceRoot,
      result.snapshotId,
    );
    const eventTimestamp = iso(options.now);
    const currentCounters = {
      pending: status.pending,
      completed: status.completed,
      inProgress: status.inProgress,
    };
    const stallReason =
      !result.completed && currentCounters.pending > 0
        ? result.processed === 0
          ? 'no-visible-work'
          : job.latestCounters &&
              !didCrawlCountersImprove(job.latestCounters, currentCounters)
            ? 'unchanged-counters'
            : null
        : null;

    appendGuiJobEvent(workspaceRoot, job.jobId, {
      timestamp: eventTimestamp,
      level: stallReason ? 'warn' : status.recentFailures.length > 0 ? 'warn' : 'info',
      stage: stallReason ? 'crawl-stalled' : 'crawl',
      message: stallReason
        ? `Crawl snapshot ${result.snapshotId} stalled after chunk`
        : result.completed
          ? `Crawl snapshot ${result.snapshotId} completed`
          : `Crawl snapshot ${result.snapshotId} paused after chunk`,
      counters: currentCounters,
      detail: {
        processed: result.processed,
        recentFailures: status.recentFailures,
        stallReason,
        previousCounters: job.latestCounters ?? null,
        currentCounters,
      },
    });
    if (stallReason) {
      await dependencies.notificationService.notify({
        level: 'warn',
        title: 'Crawl paused/stalled',
        message: `${result.snapshotId}: ${currentCounters.pending} pending items remain`,
      });
    }

    return updateGuiJob(workspaceRoot, job.jobId, {
      status: result.completed ? 'completed' : 'paused',
      snapshotId: result.snapshotId,
      resumable: true,
      latestCounters: currentCounters,
      updatedAt: eventTimestamp,
      detail: {
        ...(job.detail ?? {}),
        scope: crawlDetail.scope,
        mode: crawlDetail.mode,
        snapshotId: result.snapshotId,
      },
    });
  }

  async function runNormalizeJob(
    snapshotId: string | undefined,
    now?: Date,
  ): Promise<GuiJobRecord> {
    const job = createGuiJob(workspaceRoot, {
      jobId: randomUUID(),
      kind: 'normalize',
      snapshotId,
      now,
    });
    updateGuiJob(workspaceRoot, job.jobId, {
      status: 'running',
      updatedAt: iso(now),
    });
    const result = await dependencies.runNormalizeSnapshotWorkflow(
      workspaceRoot,
      snapshotId,
    );
    return finalizeSimpleJob(job.jobId, 'normalize', {
      pagesNormalized: result.pagesNormalized,
      snapshotId: result.snapshotId,
    }, now);
  }

  async function runRankingJob(
    snapshotId: string | undefined,
    now?: Date,
  ): Promise<GuiJobRecord> {
    const job = createGuiJob(workspaceRoot, {
      jobId: randomUUID(),
      kind: 'rank',
      snapshotId,
      now,
    });
    updateGuiJob(workspaceRoot, job.jobId, {
      status: 'running',
      updatedAt: iso(now),
    });
    const result = await dependencies.runRankingWorkflow(workspaceRoot, snapshotId);
    return finalizeSimpleJob(job.jobId, 'rank', {
      problemsRanked: result.problemsRanked,
      outputPath: result.outputPath,
    }, now);
  }

  async function runMirrorBuildJob(
    snapshotId: string | undefined,
    now?: Date,
  ): Promise<GuiJobRecord> {
    const job = createGuiJob(workspaceRoot, {
      jobId: randomUUID(),
      kind: 'mirror-build',
      snapshotId,
      now,
    });
    updateGuiJob(workspaceRoot, job.jobId, {
      status: 'running',
      updatedAt: iso(now),
    });
    const result = await dependencies.buildMirrorArtifacts(workspaceRoot, snapshotId);
    return finalizeSimpleJob(job.jobId, 'mirror-build', {
      routesBuilt: result.routesBuilt,
      snapshotId: result.snapshotId,
      outputRoot: result.outputRoot,
    }, now);
  }

  async function runFinalizeJob(
    snapshotId: string,
    now?: Date,
  ): Promise<GuiJobRecord> {
    const job = createGuiJob(workspaceRoot, {
      jobId: randomUUID(),
      kind: 'snapshot-finalize',
      snapshotId,
      now,
    });
    updateGuiJob(workspaceRoot, job.jobId, {
      status: 'running',
      updatedAt: iso(now),
    });
    const result = await dependencies.finalizeSnapshotWorkflow(workspaceRoot, snapshotId);
    const completed = finalizeSimpleJob(job.jobId, 'snapshot-finalize', {
      snapshotId: result.snapshotId,
      pagesNormalized: result.pagesNormalized,
      problemsRanked: result.problemsRanked,
      routesBuilt: result.routesBuilt,
      artifactManifestPath: result.artifactManifestPath,
    }, now);
    await dependencies.notificationService.notify({
      level: 'info',
      title: 'Snapshot finalized',
      message: result.snapshotId,
    });
    return completed;
  }

  function safeReadJob(jobId: string): GuiJobRecord | undefined {
    try {
      return readGuiJob(workspaceRoot, jobId);
    } catch {
      return undefined;
    }
  }

  function finalizeSimpleJob(
    jobId: string,
    stage: string,
    detail: Record<string, unknown>,
    now?: Date,
  ): GuiJobRecord {
    appendGuiJobEvent(workspaceRoot, jobId, {
      timestamp: iso(now),
      level: 'info',
      stage,
      message: `${stage} job completed`,
      detail,
    });
    return updateGuiJob(workspaceRoot, jobId, {
      status: 'completed',
      updatedAt: iso(now),
      detail,
    });
  }

  async function failAuthJob(
    jobId: string,
    stage: 'auth-login' | 'auth-import-browser',
    label: string,
    error: unknown,
    now?: Date,
  ): Promise<never> {
    const message = error instanceof Error ? error.message : String(error);
    appendGuiJobEvent(workspaceRoot, jobId, {
      timestamp: iso(now),
      level: 'error',
      stage,
      message,
    });
    updateGuiJob(workspaceRoot, jobId, {
      status: 'failed',
      updatedAt: iso(now),
      detail: {
        error: message,
      },
    });
    await dependencies.notificationService.notify({
      level: 'error',
      title: stage === 'auth-login' ? 'PBInfo login failed' : 'Browser import failed',
      message: `${label}: ${message}`,
    });
    throw error;
  }

  async function readCoverageExplorerWithRebuild<T>(
    reader: () => T,
    snapshotId?: string,
  ): Promise<T> {
    try {
      return reader();
    } catch (error) {
      if (
        error instanceof Error
        && error.message.includes('Problem coverage has not been generated')
      ) {
        await ensureCoverageDataset(snapshotId);
        return reader();
      }

      throw error;
    }
  }

  async function ensureCoverageDataset(snapshotId?: string): Promise<void> {
    const key = snapshotId ?? '__current__';
    const pending = coverageRefreshes.get(key);
    if (pending) {
      await pending;
      return;
    }

    const refresh = dependencies
      .runProblemCoverageWorkflow(workspaceRoot, snapshotId)
      .then(() => undefined);
    coverageRefreshes.set(key, refresh);
    try {
      await refresh;
    } finally {
      if (coverageRefreshes.get(key) === refresh) {
        coverageRefreshes.delete(key);
      }
    }
  }
}

function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function resolveCrawlDetail(
  detail: Record<string, unknown> | undefined,
): {
  scope: 'public' | 'user' | 'all';
  mode: GuiCrawlMode;
} {
  const parsed = guiCrawlJobDetailSchema.safeParse(detail ?? {
    scope: 'all',
  });
  if (parsed.success) {
    return {
      scope: parsed.data.scope,
      mode: parsed.data.mode,
    };
  }

  return {
    scope: 'all',
    mode: 'incremental',
  };
}

function didCrawlCountersImprove(
  previous: NonNullable<GuiJobRecord['latestCounters']>,
  current: NonNullable<GuiJobRecord['latestCounters']>,
): boolean {
  return (
    current.pending < previous.pending ||
    current.completed > previous.completed ||
    current.inProgress < previous.inProgress
  );
}

function mapImportedCookieToPersisted(cookie: {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
}): ProfileCookie {
  return {
    key: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  };
}

function normalizePersistedCookiesForProfile(
  cookies: SerializedSessionCookie[],
): ProfileCookie[] {
  return cookies
    .filter(
      (cookie): cookie is SerializedSessionCookie & { key: string; value: string } =>
        typeof cookie.key === 'string' && typeof cookie.value === 'string',
    )
    .map((cookie) => ({
      key: cookie.key,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }));
}
