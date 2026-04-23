import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DesktopBridge } from '../shared/bridge.js';
import type {
  GuiArchiveDataset,
  GuiArchiveListing,
  GuiArchiveRecordDetail,
  GuiArchiveState,
  GuiArchiveSummary,
  GuiCoverageDetail,
  GuiCoverageListing,
  GuiCoverageSummary,
  GuiCrawlMode,
  GuiCrawlStatus,
  GuiVerbosityMode,
  GuiJobEvent,
  GuiJobRecord,
  GuiWorkspaceState,
} from '../shared/types.js';
import { DesktopDashboard } from './dashboard.js';
import { AppShell } from './app-shell.js';
import type { CoverageExplorerFilters } from './coverage-explorer.js';
import { EmptyStateWelcome } from './library-shell/EmptyStateWelcome.js';
import './dashboard.js'; // keep legacy dashboard alive in build output for smoke test fallback

const USE_LEGACY_DASHBOARD = typeof process !== 'undefined' && process?.env?.PBINFO_DESKTOP_LEGACY_UI === '1';
void DesktopDashboard;

const CRAWL_CHUNK_SIZE = 25;
const ARCHIVE_LIST_LIMIT = 24;
const REFRESH_INTERVAL_MS = 3_000;
const CONTINUE_CRAWL_DELAY_MS = 750;

export interface AppProps {
  desktop?: DesktopBridge;
}

export function App({ desktop }: AppProps) {
  const bridge = desktop ?? readWindowBridge();
  const [archiveState, setArchiveState] = useState<GuiArchiveState | undefined>(
    undefined,
  );
  const [workspaceState, setWorkspaceState] = useState<GuiWorkspaceState | null | undefined>(
    undefined,
  );
  const [jobs, setJobs] = useState<GuiJobRecord[]>([]);
  const [crawlStatus, setCrawlStatus] = useState<GuiCrawlStatus | null>(null);
  const [jobEvents, setJobEvents] = useState<GuiJobEvent[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [crawlMode, setCrawlMode] = useState<GuiCrawlMode>('incremental');
  const [selectedArchiveDataset, setSelectedArchiveDataset] =
    useState<GuiArchiveDataset>('problems');
  const [coverageFilters, setCoverageFilters] = useState<CoverageExplorerFilters>({
    query: '',
    solved: 'all',
    testsFragmentArchived: 'all',
    visibleTestsCaptured: 'all',
    testsCoverageStatus: 'all',
    officialSourceArchived: 'all',
    userSourceArchived: 'all',
    editorialAvailability: 'all',
    archiveCompletenessStatus: 'all',
    progressState: 'all',
    sortBy: 'problem-id',
    sortDir: 'asc',
  });
  const [coverageSummary, setCoverageSummary] = useState<GuiCoverageSummary | null>(null);
  const [coverageListing, setCoverageListing] = useState<GuiCoverageListing | null>(null);
  const [selectedCoverageProblemId, setSelectedCoverageProblemId] = useState<number | null>(null);
  const [coverageDetail, setCoverageDetail] = useState<GuiCoverageDetail | null>(null);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveSummary, setArchiveSummary] = useState<GuiArchiveSummary | null>(null);
  const [archiveListing, setArchiveListing] = useState<GuiArchiveListing | null>(null);
  const [selectedArchiveRecordId, setSelectedArchiveRecordId] = useState<string | null>(null);
  const [archiveRecordDetail, setArchiveRecordDetail] =
    useState<GuiArchiveRecordDetail | null>(null);
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
    if (!bridge?.archive) {
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const state = await bridge.archive.getState();
        if (!cancelled) {
          setArchiveState(state);
        }
      } catch {
        /* ignore — legacy tests that don't mock archive fall through */
      }
    })();
    const unsubscribe = bridge.archive.onChanged((event) => {
      setArchiveState((current) =>
        current
          ? {
              ...current,
              archiveRoot: event.archiveRoot,
              snapshotId: event.snapshotId,
              found: true,
            }
          : current,
      );
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.theme || typeof document === 'undefined') {
      return undefined;
    }
    void bridge.theme.get().then(({ effective }) => {
      document.documentElement.dataset.theme = effective;
    });
    const unsubscribe = bridge.theme.onChanged(({ effective }) => {
      document.documentElement.dataset.theme = effective;
    });
    return unsubscribe;
  }, [bridge]);

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
        setArchiveSummary(null);
        setArchiveListing(null);
        setArchiveRecordDetail(null);
        setCoverageSummary(null);
        setCoverageListing(null);
        setCoverageDetail(null);
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
        setArchiveSummary(null);
        setArchiveListing(null);
        setArchiveRecordDetail(null);
        setCoverageSummary(null);
        setCoverageListing(null);
        setCoverageDetail(null);
        return;
      }

      const nextJobs = await bridge.listJobs();
      const resolvedSnapshotId =
        snapshotOverride ||
        selectedSnapshotId ||
        findLatestSnapshotId(nextJobs) ||
        '';
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

  useEffect(() => {
    if (!bridge || !workspaceState) {
      setArchiveSummary(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const summary = await bridge.getArchiveExplorerSummary(selectedSnapshotId || undefined);
        if (!cancelled) {
          setArchiveSummary(summary);
          // Auto-adopt the backend-resolved snapshot id when the renderer
          // started with an empty selection (i.e. no hardcoded fallback,
          // no prior jobs to hint at the current snapshot). Without this
          // the UI would stay on whatever default the backend picked but
          // every subsequent fetch would keep passing the empty string.
          if (!selectedSnapshotId && summary.snapshotId) {
            setSelectedSnapshotId(summary.snapshotId);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setArchiveSummary(null);
          setErrorMessage(toMessage(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, selectedSnapshotId, workspaceState]);

  useEffect(() => {
    if (!bridge || !workspaceState) {
      setCoverageSummary(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const summary = await bridge.getCoverageSummary(selectedSnapshotId);
        if (!cancelled) {
          setCoverageSummary(summary);
        }
      } catch (error) {
        if (!cancelled) {
          setCoverageSummary(null);
          setErrorMessage(toMessage(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, selectedSnapshotId, workspaceState]);

  useEffect(() => {
    if (!bridge || !workspaceState) {
      setCoverageListing(null);
      setCoverageDetail(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const listing = await bridge.listCoverageRecords({
          snapshotId: selectedSnapshotId,
          query: coverageFilters.query || undefined,
          solved: coverageFilters.solved,
          testsFragmentArchived: coverageFilters.testsFragmentArchived,
          visibleTestsCaptured: coverageFilters.visibleTestsCaptured,
          testsCoverageStatus: coverageFilters.testsCoverageStatus,
          officialSourceArchived: coverageFilters.officialSourceArchived,
          userSourceArchived: coverageFilters.userSourceArchived,
          editorialAvailability: coverageFilters.editorialAvailability,
          archiveCompletenessStatus: coverageFilters.archiveCompletenessStatus,
          grade: coverageFilters.grade,
          progressState: coverageFilters.progressState,
          languagesTried: coverageFilters.languagesTried,
          bestScoreMin: coverageFilters.bestScoreMin,
          bestScoreMax: coverageFilters.bestScoreMax,
          sortBy: coverageFilters.sortBy,
          sortDir: coverageFilters.sortDir,
          limit: 100,
        });
        if (cancelled) {
          return;
        }
        setCoverageListing(listing);
        setSelectedCoverageProblemId((current) => {
          if (current && listing.items.some((item) => item.problemId === current)) {
            return current;
          }
          return listing.items[0]?.problemId ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setCoverageListing(null);
          setCoverageDetail(null);
          setErrorMessage(toMessage(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, coverageFilters, selectedSnapshotId, workspaceState]);

  useEffect(() => {
    if (!bridge || !workspaceState || !selectedCoverageProblemId) {
      setCoverageDetail(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const detail = await bridge.getCoverageRecord({
          snapshotId: selectedSnapshotId,
          problemId: selectedCoverageProblemId,
        });
        if (!cancelled) {
          setCoverageDetail(detail);
        }
      } catch (error) {
        if (!cancelled) {
          setCoverageDetail(null);
          setErrorMessage(toMessage(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, selectedCoverageProblemId, selectedSnapshotId, workspaceState]);

  useEffect(() => {
    if (!bridge || !workspaceState) {
      setArchiveListing(null);
      setArchiveRecordDetail(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const listing = await bridge.listArchiveExplorerRecords({
          snapshotId: selectedSnapshotId,
          dataset: selectedArchiveDataset,
          query: archiveQuery || undefined,
          limit: ARCHIVE_LIST_LIMIT,
        });
        if (cancelled) {
          return;
        }
        setArchiveListing(listing);
        setSelectedArchiveRecordId((current) => {
          if (current && listing.items.some((item) => item.recordId === current)) {
            return current;
          }
          return listing.items[0]?.recordId ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setArchiveListing(null);
          setArchiveRecordDetail(null);
          setErrorMessage(toMessage(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [archiveQuery, bridge, selectedArchiveDataset, selectedSnapshotId, workspaceState]);

  useEffect(() => {
    if (!bridge || !workspaceState || !selectedArchiveRecordId) {
      setArchiveRecordDetail(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const detail = await bridge.getArchiveExplorerRecord({
          snapshotId: selectedSnapshotId,
          dataset: selectedArchiveDataset,
          recordId: selectedArchiveRecordId,
        });
        if (!cancelled) {
          setArchiveRecordDetail(detail);
        }
      } catch (error) {
        if (!cancelled) {
          setArchiveRecordDetail(null);
          setErrorMessage(toMessage(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bridge,
    selectedArchiveDataset,
    selectedArchiveRecordId,
    selectedSnapshotId,
    workspaceState,
  ]);

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

  // Library browser redesign (2026-04-23): when the archive bridge tells us
  // no archive root is discoverable, show the empty-state welcome instead of
  // the legacy shell. Tests that don't mock bridge.archive leave archiveState
  // === undefined and fall through to the legacy shell unchanged.
  if (archiveState && !archiveState.found) {
    return (
      <EmptyStateWelcome
        probedPaths={archiveState.probedPaths}
        onRunInitialCrawl={() => {
          /* wired in Task 8 */
        }}
        onBrowseForArchive={() => {
          /* wired in Task 8 */
        }}
      />
    );
  }

  const Shell = USE_LEGACY_DASHBOARD ? DesktopDashboard : AppShell;
  return (
    <Shell
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
      archiveSummary={archiveSummary}
      archiveListing={archiveListing}
      archiveRecordDetail={archiveRecordDetail}
      coverageSummary={coverageSummary}
      coverageListing={coverageListing}
      coverageDetail={coverageDetail}
      selectedCoverageProblemId={selectedCoverageProblemId}
      coverageFilters={coverageFilters}
      selectedArchiveDataset={selectedArchiveDataset}
      selectedArchiveRecordId={selectedArchiveRecordId}
      archiveQuery={archiveQuery}
      onCoverageFiltersChange={(filters) => {
        setCoverageFilters(filters);
        setSelectedCoverageProblemId(null);
      }}
      onSelectCoverageProblem={(problemId) => setSelectedCoverageProblemId(problemId)}
      onArchiveDatasetChange={(dataset) => {
        setSelectedArchiveDataset(dataset);
        setSelectedArchiveRecordId(null);
      }}
      onArchiveQueryChange={(query) => {
        setArchiveQuery(query);
        setSelectedArchiveRecordId(null);
      }}
      onSelectArchiveRecord={(recordId) => setSelectedArchiveRecordId(recordId)}
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
      onOpenPath={(path) =>
        runAction('open-path', async () => {
          await bridge?.openPath(path);
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
