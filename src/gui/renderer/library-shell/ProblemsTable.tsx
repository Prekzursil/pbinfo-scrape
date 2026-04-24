import { useEffect, useRef, useState, type RefObject } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';

import type { ProblemRowInput } from '../../main/library-repository.js';
import { ProblemRow } from './ProblemRow.js';
import { useKeyboardNav } from './useKeyboardNav.js';

export interface ProblemsTableProps {
  readonly rows: readonly ProblemRowInput[];
  readonly selectedId: string | undefined;
  readonly onOpenRow: (id: string) => void;
  readonly focusSearch: () => void;
  readonly focusFilters: () => void;
  readonly onEscape: () => void;
}

const ROW_HEIGHT = 48;
const DEFAULT_HEIGHT = 720;

export function ProblemsTable({
  rows,
  selectedId,
  onOpenRow,
  focusSearch,
  focusFilters,
  onEscape,
}: ProblemsTableProps) {
  const listRef = useRef<FixedSizeList>(null);
  // Provide a cast because useKeyboardNav expects a nullable RefObject.
  const { selectedIndex } = useKeyboardNav({
    rows,
    selectedId,
    onOpenRow,
    listRef: listRef as RefObject<FixedSizeList | null>,
    focusSearch,
    focusFilters,
    onEscape,
  });

  const [viewportHeight, setViewportHeight] = useState(DEFAULT_HEIGHT);
  useEffect(() => {
    const measure = (): void => {
      if (typeof window === 'undefined') return;
      const height = Math.max(320, window.innerHeight - 200);
      setViewportHeight(height);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const Row = ({ index, style }: ListChildComponentProps) => {
    const row = rows[index];
    if (!row) return null;
    return (
      <div style={style}>
        <ProblemRow
          row={row}
          selected={index === selectedIndex}
          onOpen={onOpenRow}
        />
      </div>
    );
  };

  return (
    <div role="table" aria-label="Problems" className="problems-table">
      <div role="rowgroup" className="problems-table__header">
        <div role="row" className="problems-table__header-row">
          <div role="columnheader" className="problem-row__id">
            #
          </div>
          <div role="columnheader" className="problem-row__name">
            Name
          </div>
          <div role="columnheader" className="problem-row__grade">
            Grade
          </div>
          <div role="columnheader" className="problem-row__progress">
            Progress
          </div>
          <div role="columnheader" className="problem-row__best">
            Best
          </div>
          <div role="columnheader" className="problem-row__captured">
            Captured
          </div>
          <div role="columnheader" className="problem-row__tags">
            Tags
          </div>
        </div>
      </div>
      <div role="rowgroup" className="problems-table__body">
        {rows.length === 0 ? (
          <p className="problems-table__empty">
            No problems match the current filters.
          </p>
        ) : (
          <FixedSizeList
            ref={listRef}
            height={viewportHeight}
            itemCount={rows.length}
            itemSize={ROW_HEIGHT}
            width="100%"
          >
            {Row}
          </FixedSizeList>
        )}
      </div>
    </div>
  );
}
