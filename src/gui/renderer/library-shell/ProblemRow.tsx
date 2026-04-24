import type { ProblemRowInput } from '../../main/library-repository.js';

export interface ProblemRowProps {
  readonly row: ProblemRowInput;
  readonly selected: boolean;
  readonly onOpen: (id: string) => void;
}

const PILLAR_KEYS = [
  'statement',
  'editorial',
  'officialSource',
  'mySource',
  'tests',
] as const;

const PILLAR_LABELS: Record<(typeof PILLAR_KEYS)[number], string> = {
  statement: 'Statement',
  editorial: 'Editorial',
  officialSource: 'Official source',
  mySource: 'My source',
  tests: 'Tests',
};

const PILLAR_GLYPH: Record<
  'captured' | 'missing' | 'restricted' | 'not-applicable',
  string
> = {
  captured: '✓',
  missing: '✗',
  restricted: '🔒',
  'not-applicable': '·',
};

const PILLAR_VALUE_LABEL: Record<
  'captured' | 'missing' | 'restricted' | 'not-applicable',
  string
> = {
  captured: 'captured',
  missing: 'not captured yet',
  restricted: 'restricted upstream',
  'not-applicable': 'not applicable',
};

export function ProblemRow({ row, selected, onOpen }: ProblemRowProps) {
  return (
    <div
      role="row"
      className={`problem-row${selected ? ' problem-row--selected' : ''}`}
      data-testid={`problem-row-${row.id}`}
      onClick={() => onOpen(row.id)}
    >
      <div role="cell" className="problem-row__id">{row.id}</div>
      <div role="cell" className="problem-row__name">{row.name}</div>
      <div role="cell" className="problem-row__grade">{row.grade ?? '—'}</div>
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
          const value = row.pillars[pillar];
          const label = `${PILLAR_LABELS[pillar]}: ${PILLAR_VALUE_LABEL[value]}`;
          return (
            <span
              key={pillar}
              role="img"
              aria-label={label}
              title={label}
              className={`problem-row__icon problem-row__icon--${value}`}
            >
              {PILLAR_GLYPH[value]}
            </span>
          );
        })}
      </div>
      <div role="cell" className="problem-row__tags">
        {row.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="problem-row__tag">{tag}</span>
        ))}
      </div>
    </div>
  );
}
