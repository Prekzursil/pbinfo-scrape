import { useCallback, useState } from 'react';

export type CompletenessFilter =
  | 'all'
  | 'complete'
  | 'incomplete-my-gap'
  | 'incomplete-upstream'
  | 'never-crawled';

export type ProgressFilter = 'all' | 'solved' | 'partial' | 'not-attempted';
export type PillarFilter =
  | 'all'
  | 'captured'
  | 'missing'
  | 'restricted'
  | 'not-applicable';
export type PresetMacro =
  | 'all'
  | 'incomplete-my-gap'
  | 'solved'
  | 'partial'
  | 'not-attempted'
  | 'upstream-blocked';

export interface LibraryFilters {
  readonly search: string;
  readonly grades: readonly number[];
  readonly progress: ProgressFilter;
  readonly completeness: CompletenessFilter;
  readonly statement: PillarFilter;
  readonly editorial: PillarFilter;
  readonly officialSource: PillarFilter;
  readonly mySource: PillarFilter;
  readonly tests: PillarFilter;
  readonly languagesTried: readonly string[];
  readonly bestScoreRange: readonly [number, number];
  readonly tags: readonly string[];
}

export const DEFAULT_FILTERS: LibraryFilters = {
  search: '',
  grades: [],
  progress: 'all',
  completeness: 'all',
  statement: 'all',
  editorial: 'all',
  officialSource: 'all',
  mySource: 'all',
  tests: 'all',
  languagesTried: [],
  bestScoreRange: [0, 100],
  tags: [],
};

export type PillarKey =
  | 'statement'
  | 'editorial'
  | 'officialSource'
  | 'mySource'
  | 'tests';

export function useFilters() {
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);

  const setSearch = useCallback(
    (search: string) => setFilters((f) => ({ ...f, search })),
    [],
  );
  const setGrades = useCallback(
    (grades: readonly number[]) => setFilters((f) => ({ ...f, grades })),
    [],
  );
  const setProgress = useCallback(
    (progress: ProgressFilter) => setFilters((f) => ({ ...f, progress })),
    [],
  );
  const setCompleteness = useCallback(
    (completeness: CompletenessFilter) =>
      setFilters((f) => ({ ...f, completeness })),
    [],
  );
  const setPillar = useCallback(
    (pillar: PillarKey, value: PillarFilter) =>
      setFilters((f) => ({ ...f, [pillar]: value })),
    [],
  );
  const setLanguages = useCallback(
    (languagesTried: readonly string[]) =>
      setFilters((f) => ({ ...f, languagesTried })),
    [],
  );
  const setBestScoreRange = useCallback(
    (bestScoreRange: readonly [number, number]) =>
      setFilters((f) => ({ ...f, bestScoreRange })),
    [],
  );
  const setTags = useCallback(
    (tags: readonly string[]) => setFilters((f) => ({ ...f, tags })),
    [],
  );

  const applyPreset = useCallback((preset: PresetMacro) => {
    setFilters(() => {
      switch (preset) {
        case 'all':
          return DEFAULT_FILTERS;
        case 'incomplete-my-gap':
          return { ...DEFAULT_FILTERS, completeness: 'incomplete-my-gap' };
        case 'solved':
          return { ...DEFAULT_FILTERS, progress: 'solved' };
        case 'partial':
          return { ...DEFAULT_FILTERS, progress: 'partial' };
        case 'not-attempted':
          return { ...DEFAULT_FILTERS, progress: 'not-attempted' };
        case 'upstream-blocked':
          return { ...DEFAULT_FILTERS, completeness: 'incomplete-upstream' };
      }
    });
  }, []);

  const reset = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  return {
    filters,
    setSearch,
    setGrades,
    setProgress,
    setCompleteness,
    setPillar,
    setLanguages,
    setBestScoreRange,
    setTags,
    applyPreset,
    reset,
  };
}
