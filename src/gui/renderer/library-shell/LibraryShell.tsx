import { useEffect, useState } from 'react';

import type { DesktopBridge, LibraryProblemRow } from '../../shared/bridge.js';
import { FilterSidebar } from './FilterSidebar.js';
import { ProblemsTable } from './ProblemsTable.js';
import { TopBar } from './TopBar.js';
import { DEFAULT_FILTERS, useFilters } from './useFilters.js';

export interface LibraryShellProps {
  readonly bridge: DesktopBridge;
  readonly archiveRoot: string;
  readonly snapshotId?: string;
}

export function LibraryShell({ bridge, archiveRoot, snapshotId }: LibraryShellProps) {
  const filtersHook = useFilters();
  const [rows, setRows] = useState<readonly LibraryProblemRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [availableTags, setAvailableTags] = useState<readonly string[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

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
      />
      {loadError && (
        <div className="library-shell__error" role="alert">
          {loadError}
        </div>
      )}
      <div className="library-shell__body">
        <FilterSidebar
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
        />
        <ProblemsTable
          rows={rows}
          selectedId={selectedId}
          onOpenRow={setSelectedId}
        />
      </div>
    </div>
  );
}

// Keep DEFAULT_FILTERS exported through this barrel for tests that want the
// initial-state reference without importing useFilters.
export { DEFAULT_FILTERS };
