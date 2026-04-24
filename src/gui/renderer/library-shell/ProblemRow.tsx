import { Check, Circle, Lock, X } from 'lucide-react';

import type { ProblemRowInput } from '../../main/library-repository.js';
import { rowStatusFor, type PillarName } from './problem-row-status.js';

export interface ProblemRowProps {
  readonly row: ProblemRowInput;
  readonly selected: boolean;
  readonly onOpen: (id: string) => void;
}

const PILLAR_KEYS: readonly PillarName[] = [
  'statement',
  'editorial',
  'officialSource',
  'mySource',
  'tests',
];

function StatusIcon({ kind }: { kind: 'ok' | 'locked' | 'gap' | 'na' }) {
  const size = 16;
  const strokeWidth = 2.25;
  switch (kind) {
    case 'ok':
      return <Check size={size} strokeWidth={strokeWidth} aria-hidden />;
    case 'locked':
      return <Lock size={size} strokeWidth={strokeWidth} aria-hidden />;
    case 'gap':
      return <X size={size} strokeWidth={strokeWidth} aria-hidden />;
    case 'na':
      return <Circle size={6} strokeWidth={0} fill="currentColor" aria-hidden />;
  }
}

export function ProblemRow({ row, selected, onOpen }: ProblemRowProps) {
  return (
    <div
      role="row"
      className={`problem-row${selected ? ' problem-row--selected' : ''}`}
      data-testid={`problem-row-${row.id}`}
      onClick={() => onOpen(row.id)}
    >
      <div role="cell" className="problem-row__id">
        {row.id}
      </div>
      <div role="cell" className="problem-row__name">
        {row.name}
      </div>
      <div role="cell" className="problem-row__grade">
        {row.grade ?? '—'}
      </div>
      <div role="cell" className="problem-row__progress">
        <span className={`pac-chip pac-chip--${row.progress}`}>
          {row.progress === 'not-attempted' ? '—' : row.progress}
        </span>
      </div>
      <div role="cell" className="problem-row__best">
        {row.bestScore > 0 ? row.bestScore : '—'}
      </div>
      <div role="cell" className="problem-row__captured">
        {PILLAR_KEYS.map((pillar) => {
          const status = rowStatusFor(pillar, row.pillars[pillar]);
          return (
            <span
              key={pillar}
              role="img"
              aria-label={status.ariaLabel}
              title={status.ariaLabel}
              className={`problem-row__icon problem-row__icon--${status.tone}`}
            >
              <StatusIcon kind={status.kind} />
            </span>
          );
        })}
      </div>
      <div role="cell" className="problem-row__tags">
        {row.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="problem-row__tag">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
