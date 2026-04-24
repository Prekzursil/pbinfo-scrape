import { forwardRef, useRef } from 'react';
import type {
  CompletenessFilter,
  LibraryFilters,
  PillarFilter,
  PillarKey,
  PresetMacro,
  ProgressFilter,
} from './useFilters.js';

export interface FilterSidebarProps {
  readonly filters: LibraryFilters;
  readonly availableTags: readonly string[];
  readonly onSearchChange: (search: string) => void;
  readonly onGradesChange: (grades: readonly number[]) => void;
  readonly onProgressChange: (progress: ProgressFilter) => void;
  readonly onCompletenessChange: (completeness: CompletenessFilter) => void;
  readonly onPillarChange: (pillar: PillarKey, value: PillarFilter) => void;
  readonly onLanguagesChange: (languages: readonly string[]) => void;
  readonly onBestScoreChange: (range: readonly [number, number]) => void;
  readonly onTagsChange: (tags: readonly string[]) => void;
  readonly onPresetClick: (preset: PresetMacro) => void;
  readonly onReset: () => void;
  readonly searchInputRef?: React.Ref<HTMLInputElement>;
}

const PRESETS: ReadonlyArray<{ preset: PresetMacro; label: string }> = [
  { preset: 'all', label: 'All' },
  { preset: 'incomplete-my-gap', label: 'Incomplete (my gap)' },
  { preset: 'solved', label: 'Solved' },
  { preset: 'partial', label: 'Partial' },
  { preset: 'not-attempted', label: 'Not attempted' },
  { preset: 'upstream-blocked', label: 'Upstream-blocked' },
];

const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];
const LANGUAGES = ['cpp', 'c', 'py', 'pas', 'java'];

const PILLAR_OPTIONS: ReadonlyArray<{ value: PillarFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'captured', label: 'Captured' },
  { value: 'missing', label: 'Missing' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'not-applicable', label: 'N/A' },
];

const PILLARS: ReadonlyArray<{ key: PillarKey; label: string }> = [
  { key: 'statement', label: 'Statement' },
  { key: 'editorial', label: 'Editorial' },
  { key: 'officialSource', label: 'Official source' },
  { key: 'mySource', label: 'My source' },
  { key: 'tests', label: 'Tests' },
];

export const FilterSidebar = forwardRef<HTMLElement, FilterSidebarProps>(
  function FilterSidebar(props, ref) {
    const toggleGrade = (grade: number): void => {
      props.onGradesChange(
        props.filters.grades.includes(grade)
          ? props.filters.grades.filter((g) => g !== grade)
          : [...props.filters.grades, grade],
      );
    };

    const toggleLanguage = (lang: string): void => {
      props.onLanguagesChange(
        props.filters.languagesTried.includes(lang)
          ? props.filters.languagesTried.filter((l) => l !== lang)
          : [...props.filters.languagesTried, lang],
      );
    };

    return (
      <aside
        ref={ref}
        className="filter-sidebar"
        tabIndex={-1}
        aria-label="Problem filters"
      >
        <div className="filter-sidebar__row">
          <input
            ref={props.searchInputRef}
            type="search"
            placeholder="Search problems…"
            value={props.filters.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            aria-label="Search problems"
          />
        </div>

        <div className="filter-sidebar__row filter-sidebar__presets">
          {PRESETS.map(({ preset, label }) => (
            <button
              key={preset}
              type="button"
              className="pac-btn pac-btn--ghost"
              onClick={() => props.onPresetClick(preset)}
            >
              {label}
            </button>
          ))}
        </div>

        <fieldset className="filter-sidebar__section">
          <legend>Grade</legend>
          <div className="filter-sidebar__chips">
            {GRADES.map((grade) => (
              <button
                key={grade}
                type="button"
                className={`pac-chip${props.filters.grades.includes(grade) ? ' pac-chip--on' : ''}`}
                aria-pressed={props.filters.grades.includes(grade)}
                onClick={() => toggleGrade(grade)}
              >
                {grade}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="filter-sidebar__section">
          <legend>Progress</legend>
          {(['all', 'solved', 'partial', 'not-attempted'] as const).map(
            (value) => (
              <label key={value} className="filter-sidebar__radio">
                <input
                  type="radio"
                  name="progress"
                  value={value}
                  checked={props.filters.progress === value}
                  onChange={() => props.onProgressChange(value)}
                />
                {radioLabel('progress', value)}
              </label>
            ),
          )}
        </fieldset>

        <fieldset className="filter-sidebar__section">
          <legend>Completeness</legend>
          {(
            [
              'all',
              'complete',
              'incomplete-my-gap',
              'incomplete-upstream',
              'never-crawled',
            ] as const
          ).map((value) => (
            <label key={value} className="filter-sidebar__radio">
              <input
                type="radio"
                name="completeness"
                value={value}
                checked={props.filters.completeness === value}
                onChange={() => props.onCompletenessChange(value)}
              />
              {radioLabel('completeness', value)}
            </label>
          ))}
        </fieldset>

        <fieldset className="filter-sidebar__section">
          <legend>Per-pillar status</legend>
          {PILLARS.map(({ key, label }) => (
            <label key={key} className="filter-sidebar__field">
              <span>{label}</span>
              <select
                value={props.filters[key]}
                onChange={(e) =>
                  props.onPillarChange(key, e.target.value as PillarFilter)
                }
              >
                {PILLAR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>

        <fieldset className="filter-sidebar__section">
          <legend>Languages tried</legend>
          <div className="filter-sidebar__chips">
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                className={`pac-chip${props.filters.languagesTried.includes(lang) ? ' pac-chip--on' : ''}`}
                aria-pressed={props.filters.languagesTried.includes(lang)}
                onClick={() => toggleLanguage(lang)}
              >
                {lang}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="filter-sidebar__section">
          <legend>Best score</legend>
          <div className="filter-sidebar__range">
            <label>
              min
              <input
                type="number"
                min={0}
                max={100}
                value={props.filters.bestScoreRange[0]}
                onChange={(e) =>
                  props.onBestScoreChange([
                    Number(e.target.value),
                    props.filters.bestScoreRange[1],
                  ])
                }
              />
            </label>
            <label>
              max
              <input
                type="number"
                min={0}
                max={100}
                value={props.filters.bestScoreRange[1]}
                onChange={(e) =>
                  props.onBestScoreChange([
                    props.filters.bestScoreRange[0],
                    Number(e.target.value),
                  ])
                }
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="filter-sidebar__section">
          <legend>Tags</legend>
          <TagAutocomplete
            available={props.availableTags}
            selected={props.filters.tags}
            onChange={props.onTagsChange}
          />
        </fieldset>

        <button
          type="button"
          className="pac-btn pac-btn--danger-ghost filter-sidebar__reset"
          onClick={props.onReset}
        >
          Reset all filters
        </button>
      </aside>
    );
  },
);

function radioLabel(
  group: 'progress' | 'completeness',
  value: string,
): string {
  if (group === 'progress') {
    return (
      {
        all: 'All',
        solved: 'Solved (100 pt)',
        partial: 'Partial',
        'not-attempted': 'Not attempted',
      } as Record<string, string>
    )[value] ?? value;
  }
  return (
    {
      all: 'All',
      complete: 'Complete',
      'incomplete-my-gap': 'Incomplete — my gap',
      'incomplete-upstream': 'Incomplete — upstream limit',
      'never-crawled': 'Never crawled',
    } as Record<string, string>
  )[value] ?? value;
}

interface TagAutocompleteProps {
  readonly available: readonly string[];
  readonly selected: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}

function TagAutocomplete({ available, selected, onChange }: TagAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = available
    .filter((t) => !selected.includes(t))
    .slice(0, 64);
  return (
    <div className="filter-sidebar__tags">
      <div className="filter-sidebar__tag-selected">
        {selected.map((tag) => (
          <button
            key={tag}
            type="button"
            className="pac-chip pac-chip--on"
            onClick={() => onChange(selected.filter((t) => t !== tag))}
          >
            {tag} ×
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        type="text"
        placeholder="Add a tag…"
        list="filter-tag-datalist"
        onChange={(e) => {
          const value = e.target.value.trim();
          if (value && available.includes(value) && !selected.includes(value)) {
            onChange([...selected, value]);
            if (inputRef.current) inputRef.current.value = '';
          }
        }}
      />
      <datalist id="filter-tag-datalist">
        {suggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}
