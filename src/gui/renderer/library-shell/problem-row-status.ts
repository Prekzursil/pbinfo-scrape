export type PillarName =
  | 'statement'
  | 'editorial'
  | 'officialSource'
  | 'mySource'
  | 'tests';

export type PillarValue =
  | 'captured'
  | 'missing'
  | 'restricted'
  | 'not-applicable';

export interface RowStatus {
  readonly kind: 'ok' | 'locked' | 'gap' | 'na';
  readonly ariaLabel: string;
  readonly tone: 'status-ok' | 'status-locked' | 'status-gap' | 'status-na';
}

const PILLAR_LABELS: Record<PillarName, string> = {
  statement: 'Statement',
  editorial: 'Editorial',
  officialSource: 'Official source',
  mySource: 'My source',
  tests: 'Tests',
};

const VALUE_LABELS: Record<PillarValue, string> = {
  captured: 'captured',
  restricted: 'restricted upstream',
  missing: 'not captured yet',
  'not-applicable': 'not applicable',
};

export function rowStatusFor(pillar: PillarName, value: PillarValue): RowStatus {
  const kind: RowStatus['kind'] =
    value === 'captured'
      ? 'ok'
      : value === 'restricted'
        ? 'locked'
        : value === 'missing'
          ? 'gap'
          : 'na';
  const tone: RowStatus['tone'] =
    kind === 'ok'
      ? 'status-ok'
      : kind === 'locked'
        ? 'status-locked'
        : kind === 'gap'
          ? 'status-gap'
          : 'status-na';
  return {
    kind,
    ariaLabel: `${PILLAR_LABELS[pillar]}: ${VALUE_LABELS[value]}`,
    tone,
  };
}
