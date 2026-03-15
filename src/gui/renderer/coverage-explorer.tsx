import type { ReactNode } from 'react';

import type {
  GuiCoverageDetail,
  GuiCoverageEditorialFilter,
  GuiCoverageListing,
  GuiCoveragePresenceFilter,
  GuiCoverageRecord,
  GuiCoverageSolvedFilter,
  GuiCoverageSummary,
} from '../shared/types.js';

export interface CoverageExplorerFilters {
  query: string;
  solved: GuiCoverageSolvedFilter;
  testsFragmentArchived: GuiCoveragePresenceFilter;
  visibleTestsCaptured: GuiCoveragePresenceFilter;
  officialSourceArchived: GuiCoveragePresenceFilter;
  userSourceArchived: GuiCoveragePresenceFilter;
  editorialAvailability: GuiCoverageEditorialFilter;
  grade?: number;
}

export interface CoverageExplorerPanelProps {
  snapshotId: string;
  summary: GuiCoverageSummary | null;
  listing: GuiCoverageListing | null;
  detail: GuiCoverageDetail | null;
  selectedProblemId: number | null;
  filters: CoverageExplorerFilters;
  previewUrl?: string;
  onFiltersChange: (next: CoverageExplorerFilters) => void;
  onSelectProblem: (problemId: number) => void;
  onOpenPath: (path: string) => Promise<unknown>;
  onOpenExternal: (url: string) => Promise<unknown>;
}

export function CoverageExplorerPanel(props: CoverageExplorerPanelProps) {
  const {
    snapshotId,
    summary,
    listing,
    detail,
    selectedProblemId,
    filters,
    previewUrl,
    onFiltersChange,
    onSelectProblem,
    onOpenPath,
    onOpenExternal,
  } = props;

  const liveMirrorUrl =
    previewUrl && detail?.record.mirrorRoute
      ? new URL(detail.record.mirrorRoute, previewUrl).toString()
      : undefined;

  const setFilter = <K extends keyof CoverageExplorerFilters>(
    key: K,
    value: CoverageExplorerFilters[K],
  ) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  return (
    <section className="panel coverage-panel panel-workspace">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Problem audit</p>
          <h2>Coverage Explorer</h2>
        </div>
        <span className="panel-chip">{snapshotId}</span>
      </div>

      <div className="coverage-workspace-top">
      <div className="coverage-summary-grid">
        <MetricCard
          label="Problems"
          value={String(summary?.totalProblems ?? listing?.totalCount ?? 0)}
          copy="All canonical problem records in the selected snapshot."
        />
        <MetricCard
          label="Solved by me"
          value={String(summary?.solvedByMeCount ?? 0)}
          copy="Derived only from your archived handle and evaluation history."
        />
        <MetricCard
          label="Tests fragments"
          value={String(summary?.testsFragmentArchivedCount ?? 0)}
          copy="Fragment archived is distinct from visible test cases parsed."
        />
        <MetricCard
          label="Archived sources"
          value={String(summary?.problemsWithArchivedSources ?? 0)}
          copy="Split below between official and user source archives."
        />
        <MetricCard
          label="Editorials visible"
          value={String(summary?.editorialVisibleCount ?? 0)}
          copy="Current editorial visibility captured in the canonical archive."
        />
        <MetricCard
          label="Ranking coverage"
          value={String(summary?.rankingPresentCount ?? 0)}
          copy="Problems with best-submission ranking data available."
        />
      </div>

      <div className="coverage-filter-toolbar" role="toolbar" aria-label="Coverage filters">
        <label className="field">
          <span>Search problems</span>
          <input
            aria-label="Search problems"
            value={filters.query}
            onChange={(event) => setFilter('query', event.target.value)}
            placeholder="Search by id, name, slug, or tag"
          />
        </label>
        <SelectField
          label="Solved"
          value={filters.solved}
          onChange={(value) => setFilter('solved', value as GuiCoverageSolvedFilter)}
          options={[
            ['all', 'All problems'],
            ['solved', 'Solved by archived handle'],
            ['unsolved', 'Unsolved'],
          ]}
        />
        <SelectField
          label="Tests fragment archived"
          value={filters.testsFragmentArchived}
          onChange={(value) =>
            setFilter('testsFragmentArchived', value as GuiCoveragePresenceFilter)
          }
          options={[
            ['all', 'All'],
            ['yes', 'Yes'],
            ['no', 'No'],
          ]}
        />
        <SelectField
          label="Visible tests captured"
          value={filters.visibleTestsCaptured}
          onChange={(value) =>
            setFilter('visibleTestsCaptured', value as GuiCoveragePresenceFilter)
          }
          options={[
            ['all', 'All'],
            ['yes', 'Yes'],
            ['no', 'No'],
          ]}
        />
        <SelectField
          label="Official source archived"
          value={filters.officialSourceArchived}
          onChange={(value) =>
            setFilter('officialSourceArchived', value as GuiCoveragePresenceFilter)
          }
          options={[
            ['all', 'All'],
            ['yes', 'Yes'],
            ['no', 'No'],
          ]}
        />
        <SelectField
          label="User source archived"
          value={filters.userSourceArchived}
          onChange={(value) =>
            setFilter('userSourceArchived', value as GuiCoveragePresenceFilter)
          }
          options={[
            ['all', 'All'],
            ['yes', 'Yes'],
            ['no', 'No'],
          ]}
        />
        <SelectField
          label="Editorial"
          value={filters.editorialAvailability}
          onChange={(value) =>
            setFilter('editorialAvailability', value as GuiCoverageEditorialFilter)
          }
          options={[
            ['all', 'All'],
            ['visible', 'Visible'],
            ['restricted', 'Restricted'],
            ['hidden', 'Hidden'],
            ['unknown', 'Unknown'],
          ]}
        />
        <label className="field">
          <span>Grade</span>
          <input
            aria-label="Grade filter"
            type="number"
            min={1}
            value={filters.grade ?? ''}
            placeholder="All"
            onChange={(event) =>
              setFilter(
                'grade',
                event.target.value ? Number(event.target.value) : undefined,
              )
            }
          />
        </label>
      </div>
      </div>

      <div className="coverage-content-grid">
        <article className="summary-card coverage-list-card">
          <div className="panel-heading compact-panel-heading">
            <div>
              <p className="section-kicker">Problem coverage</p>
              <h3>All problems</h3>
            </div>
            <span className="panel-chip">{listing?.totalCount ?? 0} visible</span>
          </div>

          {listing && listing.items.length > 0 ? (
            <div className="coverage-table-shell">
              <table className="coverage-table">
                <thead>
                  <tr>
                    <th>Problem</th>
                    <th>Grade</th>
                    <th>Solved</th>
                    <th>Evals</th>
                    <th>Tests fragment</th>
                    <th>Visible tests</th>
                    <th>Official source</th>
                    <th>User source</th>
                    <th>Editorial</th>
                  </tr>
                </thead>
                <tbody>
                  {listing.items.map((record) => (
                    <CoverageRow
                      key={record.problemId}
                      record={record}
                      active={selectedProblemId === record.problemId}
                      onSelect={onSelectProblem}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="summary-copy">
              No problems match the current coverage filters.
            </p>
          )}
        </article>

        <article className="summary-card coverage-detail-card">
          {detail ? (
            <>
              <div className="panel-heading compact-panel-heading">
                <div>
                  <p className="section-kicker">Selected problem</p>
                  <h3>
                    #{detail.record.problemId} {detail.record.name}
                  </h3>
                  <p className="summary-copy">{detail.record.slug}</p>
                </div>
                <span className="panel-chip">
                  {detail.record.solvedByMe ? 'Solved' : 'Unsolved'}
                </span>
              </div>

              <div className="coverage-badge-row">
                <CoverageBadge>
                  {detail.record.testsFragmentArchived
                    ? 'Tests fragment archived'
                    : 'Tests fragment not archived'}
                </CoverageBadge>
                <CoverageBadge>
                  Visible tests captured: {detail.record.visibleTestsCapturedCount}
                </CoverageBadge>
                <CoverageBadge>
                  {detail.record.officialSolutionPresent
                    ? 'Official solution present'
                    : 'Official solution not archived'}
                </CoverageBadge>
                <CoverageBadge>
                  {detail.record.officialSourceArchived
                    ? `Official source archived: ${detail.record.officialSourceCount}`
                    : 'Official source not archived'}
                </CoverageBadge>
                <CoverageBadge>
                  {detail.record.userSourceArchived
                    ? `User source archived: ${detail.record.userSourceCount}`
                    : 'User source not archived'}
                </CoverageBadge>
                <CoverageBadge>Editorial: {detail.record.editorialAvailability}</CoverageBadge>
              </div>

              <div className="coverage-metadata-grid">
                <MetricCard
                  label="Solved evaluations"
                  value={String(detail.record.solvedEvaluationCount)}
                />
                <MetricCard
                  label="Archived evaluations"
                  value={String(detail.record.evaluationCount)}
                />
                <MetricCard
                  label="Ranking coverage"
                  value={detail.record.rankingPresent ? 'Present' : 'Missing'}
                />
                <MetricCard
                  label="Source list"
                  value={detail.record.sourceListUrl ? 'Available upstream' : 'Not listed'}
                />
              </div>

              {detail.record.notes.length > 0 ? (
                <div className="coverage-notes">
                  <strong>Coverage notes</strong>
                  <ul>
                    {detail.record.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="button-row">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void onOpenPath(detail.rawRecordLinks.coverageFilePath)}
                >
                  Open coverage record
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void onOpenPath(detail.rawRecordLinks.problemFilePath)}
                >
                  Open problem record
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!detail.rawRecordLinks.rankingFilePath}
                  onClick={() => {
                    if (detail.rawRecordLinks.rankingFilePath) {
                      void onOpenPath(detail.rawRecordLinks.rankingFilePath);
                    }
                  }}
                >
                  Open ranking record
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!detail.rawRecordLinks.evaluationFilePaths[0]}
                  onClick={() => {
                    const evaluationFilePath = detail.rawRecordLinks.evaluationFilePaths[0];
                    if (evaluationFilePath) {
                      void onOpenPath(evaluationFilePath);
                    }
                  }}
                >
                  Open first evaluation record
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!liveMirrorUrl}
                  onClick={() => {
                    if (liveMirrorUrl) {
                      void onOpenExternal(liveMirrorUrl);
                    }
                  }}
                >
                  Open in live mirror
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!detail.record.sourceListUrl}
                  onClick={() => {
                    if (detail.record.sourceListUrl) {
                      void onOpenExternal(detail.record.sourceListUrl);
                    }
                  }}
                >
                  Open source list upstream
                </button>
              </div>

              <p className="summary-copy">
                Mirror route: <span className="mono">{detail.record.mirrorRoute}</span>
              </p>
            </>
          ) : (
            <p className="summary-copy">
              Select a problem to inspect solved state, test fragments, source-code coverage,
              and raw normalized record links.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

function CoverageRow({
  record,
  active,
  onSelect,
}: {
  record: GuiCoverageRecord;
  active: boolean;
  onSelect: (problemId: number) => void;
}) {
  return (
    <tr className={active ? 'coverage-row-active' : undefined}>
      <td>
        <button
          className="coverage-row-button"
          type="button"
          onClick={() => onSelect(record.problemId)}
        >
          #{record.problemId} {record.name}
        </button>
        <div className="summary-copy">{record.slug}</div>
      </td>
      <td>{record.grade ?? '—'}</td>
      <td>{record.solvedByMe ? 'Solved' : 'Unsolved'}</td>
      <td>{record.evaluationCount}</td>
      <td>{record.testsFragmentArchived ? 'Yes' : 'No'}</td>
      <td>{record.visibleTestsCapturedCount}</td>
      <td>{record.officialSourceArchived ? 'Yes' : 'No'}</td>
      <td>{record.userSourceArchived ? 'Yes' : 'No'}</td>
      <td>{record.editorialAvailability}</td>
    </tr>
  );
}

function MetricCard({
  label,
  value,
  copy,
  className,
}: {
  label: string;
  value: string;
  copy?: string;
  className?: string;
}) {
  return (
    <article className={`summary-card ${className ?? ''}`.trim()}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      {copy ? <p className="summary-copy">{copy}</p> : null}
    </article>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function CoverageBadge({ children }: { children: ReactNode }) {
  return <span className="coverage-badge">{children}</span>;
}
