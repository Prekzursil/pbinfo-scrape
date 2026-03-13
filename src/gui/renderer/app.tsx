import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DesktopBridge } from '../shared/bridge.js';
import type {
  GuiCrawlMode,
  GuiCrawlStatus,
  GuiVerbosityMode,
  GuiJobEvent,
  GuiJobRecord,
  GuiWorkspaceState,
} from '../shared/types.js';
import { DesktopDashboard } from './dashboard.js';

const CRAWL_CHUNK_SIZE = 25;
const REFRESH_INTERVAL_MS = 3_000;
const CONTINUE_CRAWL_DELAY_MS = 750;

export interface AppProps {
  desktop?: DesktopBridge;
}

export function App({ desktop }: AppProps) {
  const bridge = desktop ?? readWindowBridge();
  const [workspaceState, setWorkspaceState] = useState<GuiWorkspaceState | null | undefined>(
    undefined,
  );
  const [jobs, setJobs] = useState<GuiJobRecord[]>([]);
  const [crawlStatus, setCrawlStatus] = useState<GuiCrawlStatus | null>(null);
  const [jobEvents, setJobEvents] = useState<GuiJobEvent[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('acceptance-20260310b');
  const [crawlMode, setCrawlMode] = useState<GuiCrawlMode>('incremental');
  const [verbosityMode, setVerbosityMode] = useState<GuiVerbosityMode>('normal');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [crawlLoopJobId, setCrawlLoopJobId] = useState<string | null>(null);
  const crawlLoopTickingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!bridge) {
      return undefined;
    }

    let cancelled = false;
    void (async () => {
      try {
        const preferences = await bridge.getDesktopPreferences();
        if (!cancelled) {
          setVerbosityMode(preferences.verbosityMode);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(toMessage(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const refresh = useCallback(
    async (snapshotOverride?: string) => {
      if (!bridge) {
        setWorkspaceState(null);
        setJobs([]);
        setCrawlStatus(null);
        setJobEvents([]);
        return;
      }

      const nextWorkspace = await bridge.getWorkspaceState();
      if (!isMountedRef.current) {
        return;
      }

      if (!nextWorkspace) {
        setWorkspaceState(null);
        setJobs([]);
        setCrawlStatus(null);
        setJobEvents([]);
        return;
      }

      const nextJobs = await bridge.listJobs();
      const resolvedSnapshotId =
        snapshotOverride ??
        selectedSnapshotId ??
        findLatestSnapshotId(nextJobs) ??
        'acceptance-20260310b';
      if (resolvedSnapshotId !== selectedSnapshotId) {
        setSelectedSnapshotId(resolvedSnapshotId);
      }

      const [nextCrawlStatus, nextJobEvents] = await Promise.all([
        bridge
          .getCrawlStatus(resolvedSnapshotId)
          .catch(() => null as GuiCrawlStatus | null),
        readPreferredJobEvents(bridge, nextJobs, verbosityMode, resolvedSnapshotId),
      ]);

      if (!isMountedRef.current) {
        return;
      }

      setWorkspaceState(nextWorkspace);
      setJobs(nextJobs);
      setCrawlStatus(nextCrawlStatus);
      setJobEvents(nextJobEvents);
    },
    [bridge, selectedSnapshotId, verbosityMode],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refresh();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(toMessage(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!bridge || workspaceState === undefined || workspaceState === null) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [bridge, refresh, workspaceState]);

  const activeCrawlJob = useMemo(
    () =>
      jobs.find((job) => job.jobId === crawlLoopJobId) ??
      [...jobs].reverse().find((job) => job.kind === 'crawl'),
    [crawlLoopJobId, jobs],
  );

  useEffect(() => {
    if (!bridge || !crawlLoopJobId || !activeCrawlJob) {
      return undefined;
    }

    if (
      activeCrawlJob.status === 'completed' ||
      activeCrawlJob.status === 'failed' ||
      activeCrawlJob.status === 'cancelled'
    ) {
      setCrawlLoopJobId(null);
      return undefined;
    }

    if (
      activeCrawlJob.status !== 'paused' ||
      !activeCrawlJob.resumable ||
      crawlLoopTickingRef.current
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      crawlLoopTickingRef.current = true;
      void (async () => {
        try {
          const resumed = await bridge.resumeJob(activeCrawlJob.jobId, {
            maxIterations: CRAWL_CHUNK_SIZE,
          });
          await refresh(resumed.snapshotId ?? selectedSnapshotId);
        } catch (error) {
          setCrawlLoopJobId(null);
          setErrorMessage(toMessage(error));
        } finally {
          crawlLoopTickingRef.current = false;
        }
      })();
    }, CONTINUE_CRAWL_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeCrawlJob, bridge, crawlLoopJobId, refresh, selectedSnapshotId]);

  const runAction = useCallback(
    async <T,>(label: string, action: () => Promise<T>, successMessage?: string) => {
      setBusyAction(label);
      setErrorMessage(null);
      try {
        const result = await action();
        if (successMessage) {
          setStatusMessage(successMessage);
        }
        return result;
      } catch (error) {
        setErrorMessage(toMessage(error));
        return undefined;
      } finally {
        setBusyAction(null);
      }
    },
    [],
  );

  const previewJob = useMemo(
    () =>
      [...jobs]
        .reverse()
        .find((job) => job.kind === 'mirror-serve' && typeof job.detail?.mirrorPreviewUrl === 'string'),
    [jobs],
  );
  const previewUrl =
    typeof previewJob?.detail?.mirrorPreviewUrl === 'string'
      ? previewJob.detail.mirrorPreviewUrl
      : undefined;
  const handleVerbosityChange = useCallback(
    (nextVerbosityMode: GuiVerbosityMode) => {
      setVerbosityMode(nextVerbosityMode);
      if (!bridge) {
        return;
      }

      void bridge.setVerbosityMode(nextVerbosityMode).catch((error) => {
        setErrorMessage(toMessage(error));
      });
    },
    [bridge],
  );

  return (
    <DesktopDashboard
      workspaceState={workspaceState}
      jobs={jobs}
      crawlStatus={crawlStatus}
      jobEvents={jobEvents}
      selectedSnapshotId={selectedSnapshotId}
      selectedCrawlMode={crawlMode}
      verbosityMode={verbosityMode}
      busyAction={busyAction}
      statusMessage={statusMessage}
      errorMessage={errorMessage}
      previewUrl={previewUrl}
      previewJobId={previewJob?.jobId}
      showAdvanced={showAdvanced}
      onToggleAdvanced={() => setShowAdvanced((value) => !value)}
      onSnapshotChange={(value) => setSelectedSnapshotId(value)}
      onCrawlModeChange={(value) => setCrawlMode(value)}
      onVerbosityChange={handleVerbosityChange}
      onSelectWorkspace={(workspaceRoot) =>
        runAction(
          'select-workspace',
          async () => {
            const result = await bridge?.selectWorkspace(workspaceRoot);
            await refresh();
            return result;
          },
          `Workspace ready: ${workspaceRoot}`,
        )
      }
      onRefresh={() => runAction('refresh', () => refresh())}
      onLoginProfile={(input) =>
        runAction(
          'auth-login',
          async () => {
            const result = await bridge?.loginProfile(input);
            await refresh();
            return result;
          },
          `Activated profile ${input.label}`,
        )
      }
      onImportBrowserProfile={(input) =>
        runAction(
          'auth-import-browser',
          async () => {
            const result = await bridge?.importBrowserProfile(input);
            await refresh();
            return result;
          },
          `Imported browser session for ${input.label}`,
        )
      }
      onActivateProfile={(profileId) =>
        runAction(
          'activate-profile',
          async () => {
            const result = await bridge?.activateProfile(profileId);
            await refresh();
            return result;
          },
          `Activated profile ${profileId}`,
        )
      }
      onDeleteProfile={(profileId) =>
        runAction(
          'delete-profile',
          async () => {
            const result = await bridge?.deleteProfile(profileId);
            await refresh();
            return result;
          },
          `Deleted profile ${profileId}`,
        )
      }
      onStartCrawl={(scope) =>
        runAction(
          `crawl-${scope}`,
          async () => {
            const job = await bridge?.startJob({
              kind: 'crawl',
              snapshotId: selectedSnapshotId,
              detail: {
                scope,
                mode: crawlMode,
              },
              maxIterations: CRAWL_CHUNK_SIZE,
            });
            if (job) {
              setCrawlLoopJobId(job.jobId);
              await refresh(job.snapshotId ?? selectedSnapshotId);
            }
            return job;
          },
          `Started ${scope} crawl`,
        )
      }
      onPauseCrawl={(jobId) =>
        runAction(
          'pause-crawl',
          async () => {
            setCrawlLoopJobId(null);
            const result = await bridge?.pauseJob(jobId);
            await refresh();
            return result;
          },
          'Crawl paused',
        )
      }
      onResumeCrawl={(jobId) =>
        runAction(
          'resume-crawl',
          async () => {
            const result = await bridge?.resumeJob(jobId, {
              maxIterations: CRAWL_CHUNK_SIZE,
            });
            if (result) {
              setCrawlLoopJobId(jobId);
              await refresh(result.snapshotId ?? selectedSnapshotId);
            }
            return result;
          },
          'Crawl resumed',
        )
      }
      onRunSnapshotJob={(kind) =>
        runAction(
          kind,
          async () => {
            const job = await bridge?.startJob({
              kind,
              snapshotId: selectedSnapshotId,
            });
            await refresh(selectedSnapshotId);
            return job;
          },
          `${kind} completed`,
        )
      }
      onStartMirrorPreview={() =>
        runAction(
          'mirror-preview',
          async () => {
            const result = await bridge?.startMirrorPreview(selectedSnapshotId);
            await refresh(selectedSnapshotId);
            return result;
          },
          'Mirror preview started',
        )
      }
      onStopMirrorPreview={(jobId) =>
        runAction(
          'mirror-stop',
          async () => {
            const result = await bridge?.stopMirrorPreview(jobId);
            await refresh(selectedSnapshotId);
            return result;
          },
          'Mirror preview stopped',
        )
      }
      onOpenExternal={(url) =>
        runAction('open-external', async () => {
          await bridge?.openExternal(url);
        })
      }
      publishCommand={buildPublishCommand(
        workspaceState?.workspaceRoot,
        crawlStatus?.snapshotId,
        crawlStatus?.publishEligible ?? false,
      )}
    />
  );
}

function readWindowBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as Window & { pbinfoDesktop?: DesktopBridge }).pbinfoDesktop;
}

async function readPreferredJobEvents(
  bridge: DesktopBridge,
  jobs: GuiJobRecord[],
  verbosityMode: GuiVerbosityMode,
  snapshotId?: string,
): Promise<GuiJobEvent[]> {
  const preferredJob = [...jobs]
    .reverse()
    .find(
      (job) =>
        job.kind === 'crawl' &&
        (!snapshotId || job.snapshotId === snapshotId),
    )
    ?? [...jobs]
      .reverse()
      .find((job) => job.kind === 'crawl')
    ?? [...jobs]
      .reverse()
      .find((job) => job.kind === 'snapshot-finalize' || job.kind === 'mirror-build');
  if (!preferredJob) {
    return [];
  }

  const eventLimit =
    preferredJob.kind === 'crawl'
      ? verbosityMode === 'raw'
        ? 120
        : 60
      : verbosityMode === 'raw'
        ? 80
        : verbosityMode === 'verbose'
          ? 40
          : 18;

  return bridge
    .listJobEvents(preferredJob.jobId, eventLimit)
    .catch(() => []);
}

function findLatestSnapshotId(jobs: GuiJobRecord[]): string | undefined {
  return [...jobs]
    .reverse()
    .find((job) => typeof job.snapshotId === 'string' && job.snapshotId.length > 0)?.snapshotId;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildPublishCommand(
  workspaceRoot: string | undefined,
  snapshotId: string | undefined,
  publishEligible: boolean,
): string | null {
  if (!workspaceRoot || !snapshotId || !publishEligible) {
    return null;
  }

  return `npm run cli -- --workspace "${workspaceRoot}" publish --snapshot ${snapshotId}`;
}
