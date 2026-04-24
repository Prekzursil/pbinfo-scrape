import { ProblemRow } from './ProblemRow.js';
import type { ProblemRowInput } from '../../main/library-repository.js';

export interface ProblemsTableProps {
  readonly rows: readonly ProblemRowInput[];
  readonly selectedId: string | undefined;
  readonly onOpenRow: (id: string) => void;
}

export function ProblemsTable({ rows, selectedId, onOpenRow }: ProblemsTableProps) {
  return (
    <div role="table" aria-label="Problems" className="problems-table">
      <div role="rowgroup" className="problems-table__header">
        <div role="row" className="problems-table__header-row">
          <div role="columnheader" className="problem-row__id">#</div>
          <div role="columnheader" className="problem-row__name">Name</div>
          <div role="columnheader" className="problem-row__grade">Grade</div>
          <div role="columnheader" className="problem-row__progress">Progress</div>
          <div role="columnheader" className="problem-row__best">Best</div>
          <div role="columnheader" className="problem-row__captured">Captured</div>
          <div role="columnheader" className="problem-row__tags">Tags</div>
        </div>
      </div>
      <div role="rowgroup" className="problems-table__body">
        {rows.length === 0 ? (
          <p className="problems-table__empty">No problems match the current filters.</p>
        ) : (
          rows.map((row) => (
            <ProblemRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onOpen={onOpenRow}
            />
          ))
        )}
      </div>
    </div>
  );
}
