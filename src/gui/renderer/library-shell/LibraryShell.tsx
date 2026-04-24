import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  DesktopBridge,
  LibraryProblemRow,
  RefreshProgressEvent,
} from '../../shared/bridge.js';
import { FilterSidebar } from './FilterSidebar.js';
import { OperatorMenu } from './OperatorMenu.js';
import { ProblemDrawer } from './ProblemDrawer.js';
import { ProblemsTable } from './ProblemsTable.js';
import { ProgressPanel } from './ProgressPanel.js';
import { SettingsModal } from './SettingsModal.js';
import { TopBar } from './TopBar.js';
import { DEFAULT_FILTERS, useFilters } from './useFilters.js';

export interface LibraryShellProps {
  readonly bridge: DesktopBridge;
  readonly archiveRoot: string;
  readonly snapshotId?: string;
  readonly theme?: 'light' | 'dark';
}

export function LibraryShell({
  bridge,
  archiveRoot,
  snapshotId,
  theme = 'light',
}: LibraryShellProps) {
  const filtersHook = useFilters();
  const [rows, setRows] = useState<readonly LibraryProblemRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [availableTags, setAvailableTags] = useState<readonly string[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [progressEvent, setProgressEvent] = useState<
    RefreshProgressEvent | undefined
  >(undefined);
  const [activeJobId, setActiveJobId] = useState<string | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select?.();
  }, []);
  const focusFilters = useCallback(() => {
    sidebarRef.current?.focus();
  }, []);
  const clearSelection = useCallback(() => setSelectedId(undefined), []);

  useEffect(() => {
    const unsub = bridge.operator.onProgress((event) => {
      setProgressEvent(event);
      if (event.phase === 'finalize') {
        setActiveJobId(undefined);
      } else {
        setActiveJobId(event.jobId);
      }
    });
    return unsub;
  }, [bridge]);

  const handleRunFullRefresh = useCallback(async () => {
    try {
      const result = await bridge.operator.runFullRefresh({});
      setActiveJobId(result.jobId);
    } catch {
      /* surface via progress panel finalize event */
    }
  }, [bridge]);

  const handleCancelRefresh = useCallback(() => {
    if (!activeJobId) return;
    void bridge.operator.runFullRefreshCancel({ jobId: activeJobId });
  }, [bridge, activeJobId]);

  const handleReauthenticate = useCallback(() => {
    setSettingsOpen(true);
    // The Settings modal currently surfaces re-auth only via theme/snapshot;
    // a dedicated credentials panel would live in Task 9+ polish. For now
    // we open Settings as the single "operator control surface".
  }, []);

  const handleOpenLiveSiteViewer = useCallback(() => {
    void bridge.operator.openLiveSiteViewer({});
  }, [bridge]);

  const handleOpenDataExplorer = useCallback(() => {
    // Existing Data explorer lives in the legacy shell until Task 9 deletes
    // it. For iteration 3 we just point users at the existing flow via a
    // notice; Task 9 either keeps this as a "classic view" link or wires a
    // new renderer. No-op placeholder for now.
    console.info('Data explorer is available in the legacy shell; Task 9 deletes or rewires it.');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void bridge.library
      .listTags({ snapshotId })
      .then((tags) => {
        if (!cancelled) setAvailableTags(tags);
      })
      .catch(() => {
        /* tag load failure is non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, snapshotId]);

  useEffect(() => {
    let cancelled = false;
    void bridge.library
      .listProblems({
        snapshotId,
        filters: filtersHook.filters,
        sort: { key: 'id', dir: 'asc' },
        limit: 2500,
        offset: 0,
      })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotalCount(result.totalCount);
        setLoadError(undefined);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRows([]);
        setTotalCount(0);
        setLoadError(
          error instanceof Error ? error.message : 'Failed to load problems',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, filtersHook.filters, snapshotId]);

  useEffect(() => {
    if (!bridge.archive) return undefined;
    const unsubscribe = bridge.archive.onChanged(() => {
      // Trigger refetch by toggling search identity through a no-op set
      filtersHook.setSearch(filtersHook.filters.search);
    });
    return unsubscribe;
  }, [bridge, filtersHook]);

  return (
    <div className="library-shell">
      <TopBar
        archiveRoot={archiveRoot}
        snapshotId={snapshotId}
        totalCount={totalCount}
        progressChip={
          progressEvent && progressEvent.phase !== 'finalize' ? (
            <span
              className="library-shell__progress-chip"
              title={`Phase: ${progressEvent.phase}`}
            >
              {progressEvent.phase}:{' '}
              {progressEvent.total
                ? `${progressEvent.processed}/${progressEvent.total}`
                : progressEvent.processed}
            </span>
          ) : undefined
        }
        operatorMenu={
          <OperatorMenu
            bridge={bridge}
            sessionLabel={undefined}
            onReauthenticate={handleReauthenticate}
            onRunFullRefresh={handleRunFullRefresh}
            onOpenDataExplorer={handleOpenDataExplorer}
            onOpenLiveSiteViewer={handleOpenLiveSiteViewer}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        }
      />
      {progressEvent && (
        <ProgressPanel
          event={progressEvent}
          onCancel={activeJobId ? handleCancelRefresh : undefined}
        />
      )}
      <SettingsModal
        bridge={bridge}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      {loadError && (
        <div className="library-shell__error" role="alert">
          {loadError}
        </div>
      )}
      <div className="library-shell__body">
        <FilterSidebar
          ref={sidebarRef}
          filters={filtersHook.filters}
          availableTags={availableTags}
          onSearchChange={filtersHook.setSearch}
          onGradesChange={filtersHook.setGrades}
          onProgressChange={filtersHook.setProgress}
          onCompletenessChange={filtersHook.setCompleteness}
          onPillarChange={filtersHook.setPillar}
          onLanguagesChange={filtersHook.setLanguages}
          onBestScoreChange={filtersHook.setBestScoreRange}
          onTagsChange={filtersHook.setTags}
          onPresetClick={filtersHook.applyPreset}
          onReset={filtersHook.reset}
          searchInputRef={searchInputRef}
        />
        <ProblemsTable
          rows={rows}
          selectedId={selectedId}
          onOpenRow={setSelectedId}
          focusSearch={focusSearch}
          focusFilters={focusFilters}
          onEscape={clearSelection}
        />
        <ProblemDrawer
          bridge={bridge}
          snapshotId={snapshotId}
          problemId={selectedId}
          onClose={clearSelection}
          theme={theme}
        />
      </div>
    </div>
  );
}

// Keep DEFAULT_FILTERS exported through this barrel for tests that want the
// initial-state reference without importing useFilters.
export { DEFAULT_FILTERS };
