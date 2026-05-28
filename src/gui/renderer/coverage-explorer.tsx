import type { ReactNode } from 'react';

import type {
  GuiCoverageArchiveStateFilter,
  GuiCoverageDetail,
  GuiCoverageEditorialFilter,
  GuiCoverageListing,
  GuiCoveragePresenceFilter,
  GuiCoverageRecord,
  GuiCoverageSolvedFilter,
  GuiCoverageSummary,
  GuiCoverageTestsStatusFilter,
} from '../shared/types.js';

export interface CoverageExplorerFilters {
  query: string;
  solved: GuiCoverageSolvedFilter;
  testsFragmentArchived: GuiCoveragePresenceFilter;
  visibleTestsCaptured: GuiCoveragePresenceFilter;
  testsCoverageStatus: GuiCoverageTestsStatusFilter;
  officialSourceArchived: GuiCoveragePresenceFilter;
  userSourceArchived: GuiCoveragePresenceFilter;
  editorialAvailability: GuiCoverageEditorialFilter;
  archiveCompletenessStatus: GuiCoverageArchiveStateFilter;
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
        <CoverageSummaryGrid summary={summary} listing={listing} />
        <CoverageFilterToolbar filters={filters} setFilter={setFilter} />
      </div>

      <div className="coverage-content-grid">
        <CoverageListCard
          listing={listing}
          selectedProblemId={selectedProblemId}
          onSelectProblem={onSelectProblem}
        />
        <CoverageDetailCard
          detail={detail}
          previewUrl={previewUrl}
          onOpenPath={onOpenPath}
          onOpenExternal={onOpenExternal}
        />
      </div>
    </section>
  );
}

const SUMMARY_METRIC_KEYS = [
  'solvedByMeCount',
  'testsFragmentArchivedCount',
  'problemsWithEffectiveTests',
  'problemsWithArchivedSources',
  'rankingPresentCount',
  'newSinceBaselineCount',
  'editorialVisibleCount',
] as const;

type SummaryMetricKey = (typeof SUMMARY_METRIC_KEYS)[number];
type SummaryMetricValues = Record<SummaryMetricKey | 'totalProblems', string>;

function resolveSummaryMetricValues(
  summary: GuiCoverageSummary | null,
  listing: GuiCoverageListing | null,
): SummaryMetricValues {
  const s = summary ?? ({} as Partial<GuiCoverageSummary>);
  const values = {
    totalProblems: String(s.totalProblems ?? listing?.totalCount ?? 0),
  } as SummaryMetricValues;
  for (const key of SUMMARY_METRIC_KEYS) {
    values[key] = String(s[key] ?? 0);
  }
  return values;
}

function CoverageSummaryGrid(props: {
  summary: GuiCoverageSummary | null;
  listing: GuiCoverageListing | null;
}) {
  const values = resolveSummaryMetricValues(props.summary, props.listing);
  return (
    <div className="coverage-summary-grid">
      <MetricCard
        label="Problems"
        value={values.totalProblems}
        copy="All canonical problem records in the selected snapshot."
      />
      <MetricCard
        label="Solved by me"
        value={values.solvedByMeCount}
        copy="Derived only from your archived handle and evaluation history."
      />
      <MetricCard
        label="Tests fragments"
        value={values.testsFragmentArchivedCount}
        copy="Fragment archived is distinct from visible test cases parsed."
      />
      <MetricCard
        label="Effective tests"
        value={values.problemsWithEffectiveTests}
        copy="Deduplicated example, visible, and evaluation-observed test coverage."
      />
      <MetricCard
        label="Archived sources"
        value={values.problemsWithArchivedSources}
        copy="Split below between official and user source archives."
      />
      <MetricCard
        label="Ranking coverage"
        value={values.rankingPresentCount}
        copy="Problems with best-submission ranking data available."
      />
      <MetricCard
        label="New vs baseline"
        value={values.newSinceBaselineCount}
        copy="Problems whose effective test or source coverage improved beyond acceptance-20260310b."
      />
      <MetricCard
        label="Editorials visible"
        value={values.editorialVisibleCount}
        copy="Current editorial visibility captured in the canonical archive."
      />
    </div>
  );
}

function CoverageFilterToolbar(props: {
  filters: CoverageExplorerFilters;
  setFilter: <K extends keyof CoverageExplorerFilters>(
    key: K,
    value: CoverageExplorerFilters[K],
  ) => void;
}) {
  const { filters, setFilter } = props;
  return (
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
        onChange={(value) => setFilter('testsFragmentArchived', value as GuiCoveragePresenceFilter)}
        options={[
          ['all', 'All'],
          ['yes', 'Yes'],
          ['no', 'No'],
        ]}
      />
      <SelectField
        label="Visible tests captured"
        value={filters.visibleTestsCaptured}
        onChange={(value) => setFilter('visibleTestsCaptured', value as GuiCoveragePresenceFilter)}
        options={[
          ['all', 'All'],
          ['yes', 'Yes'],
          ['no', 'No'],
        ]}
      />
      <SelectField
        label="Tests status"
        value={filters.testsCoverageStatus}
        onChange={(value) =>
          setFilter('testsCoverageStatus', value as GuiCoverageTestsStatusFilter)
        }
        options={[
          ['all', 'All'],
          ['captured', 'Captured'],
          ['not-available-upstream', 'Not available upstream'],
          ['not-captured-yet', 'Not captured yet'],
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
        onChange={(value) => setFilter('userSourceArchived', value as GuiCoveragePresenceFilter)}
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
      <SelectField
        label="Archive state"
        value={filters.archiveCompletenessStatus}
        onChange={(value) =>
          setFilter('archiveCompletenessStatus', value as GuiCoverageArchiveStateFilter)
        }
        options={[
          ['all', 'All'],
          ['complete', 'Complete'],
          ['unsolved', 'Unsolved'],
          ['not-archived-yet', 'Not archived yet'],
          ['missing-official-source', 'Missing official source'],
          ['missing-user-source', 'Missing user source'],
          ['incomplete', 'Incomplete'],
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
            setFilter('grade', event.target.value ? Number(event.target.value) : undefined)
          }
        />
      </label>
    </div>
  );
}

function CoverageListCard(props: {
  listing: GuiCoverageListing | null;
  selectedProblemId: number | null;
  onSelectProblem: (problemId: number) => void;
}) {
  const { listing, selectedProblemId, onSelectProblem } = props;
  const hasItems = Boolean(listing && listing.items.length > 0);
  return (
    <article className="summary-card coverage-list-card">
      <div className="panel-heading compact-panel-heading">
        <div>
          <p className="section-kicker">Problem coverage</p>
          <h3>All problems</h3>
        </div>
        <span className="panel-chip">{listing?.totalCount ?? 0} visible</span>
      </div>

      {hasItems ? (
        <div className="coverage-table-shell">
          <table className="coverage-table">
            <thead>
              <tr>
                <th>Problem</th>
                <th>Grade</th>
                <th>Solved</th>
                <th>Evals</th>
                <th>Tests fragment</th>
                <th>Effective tests</th>
                <th>Visible tests</th>
                <th>Official source</th>
                <th>Trustworthy user source</th>
                <th>Editorial</th>
              </tr>
            </thead>
            <tbody>
              {listing?.items.map((record) => (
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
        <p className="summary-copy">No problems match the current coverage filters.</p>
      )}
    </article>
  );
}

function CoverageDetailBadges(props: { record: GuiCoverageRecord }) {
  const { record } = props;
  const officialSourceLanguages = record.officialSourceLanguages ?? [];
  const trustworthyLanguages = record.trustworthyUserSourceLanguages ?? [];
  return (
    <div className="coverage-badge-row">
      <CoverageBadge>
        Tests status: {humanizeTestsCoverageStatus(record.testsCoverageStatus)}
      </CoverageBadge>
      <CoverageBadge>
        {record.testsFragmentArchived ? 'Tests fragment archived' : 'Tests fragment not archived'}
      </CoverageBadge>
      <CoverageBadge>
        Effective tests available: {record.effectiveTestsAvailableCount}
      </CoverageBadge>
      <CoverageBadge>Visible tests captured: {record.visibleTestsCapturedCount}</CoverageBadge>
      <CoverageBadge>Example tests: {record.exampleTestsAvailableCount}</CoverageBadge>
      <CoverageBadge>
        {record.officialSolutionPresent
          ? 'Official solution present'
          : 'Official solution not archived'}
      </CoverageBadge>
      <CoverageBadge>
        {record.officialSourceArchived
          ? `Official source languages: ${officialSourceLanguages.join(', ')}`
          : `Official source ${humanizeOfficialSourceStatus(record.officialSourceStatus).toLowerCase()}`}
      </CoverageBadge>
      <CoverageBadge>
        {trustworthyLanguages.length > 0
          ? `Trustworthy user languages: ${trustworthyLanguages.join(', ')}`
          : 'No trustworthy 100-point user language archived'}
      </CoverageBadge>
      <CoverageBadge>
        Archive state: {humanizeArchiveState(record.archiveCompletenessStatus)}
      </CoverageBadge>
      <CoverageBadge>Editorial: {record.editorialAvailability}</CoverageBadge>
      {record.newSinceBaseline ? <CoverageBadge>New since baseline</CoverageBadge> : null}
      {record.officialSourceBlockedReason ? (
        <CoverageBadge>Official source blocked: {record.officialSourceBlockedReason}</CoverageBadge>
      ) : null}
    </div>
  );
}

function joinOrFallback(values: string[], fallback: string): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

function CoverageDetailMetadata(props: { record: GuiCoverageDetail['record'] }) {
  const { record } = props;
  const officialSourceLanguages = record.officialSourceLanguages ?? [];
  const userSourceLanguages = record.userSourceLanguages ?? [];
  const missingTrustworthyLanguages = record.missingTrustworthyUserSourceLanguages ?? [];
  return (
    <div className="coverage-metadata-grid">
      <MetricCard label="Solved evaluations" value={String(record.solvedEvaluationCount)} />
      <MetricCard label="Archived evaluations" value={String(record.evaluationCount)} />
      <MetricCard label="Ranking coverage" value={record.rankingPresent ? 'Present' : 'Missing'} />
      <MetricCard
        label="Source list"
        value={record.sourceListUrl ? 'Available upstream' : 'Not listed'}
      />
      <MetricCard
        label="Official sources"
        value={String(record.officialSourceCount)}
        copy={joinOrFallback(officialSourceLanguages, 'No archived 100-point official sources')}
      />
      <MetricCard
        label="User sources"
        value={String(record.userSourceCount)}
        copy={
          userSourceLanguages.length > 0
            ? `Archived languages: ${userSourceLanguages.join(', ')}`
            : 'No archived user source bodies'
        }
      />
      <MetricCard
        label="Missing trustworthy"
        value={joinOrFallback(missingTrustworthyLanguages, 'None')}
      />
      <MetricCard
        label="Required solved languages"
        value={joinOrFallback(record.requiredTrustworthyUserSourceLanguages, 'None')}
      />
      <MetricCard
        label="Best trustworthy per language"
        value={
          Object.keys(record.bestTrustworthyUserPerLanguage).length > 0
            ? formatEvaluationMap(record.bestTrustworthyUserPerLanguage)
            : 'None'
        }
      />
      <MetricCard
        label="Archive state"
        value={humanizeArchiveState(record.archiveCompletenessStatus)}
      />
    </div>
  );
}

function CoverageDetailActions(props: {
  detail: GuiCoverageDetail;
  liveMirrorUrl?: string;
  onOpenPath: (path: string) => Promise<unknown>;
  onOpenExternal: (url: string) => Promise<unknown>;
}) {
  const { detail, liveMirrorUrl, onOpenPath, onOpenExternal } = props;
  return (
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
  );
}

function CoverageDetailCard(props: {
  detail: GuiCoverageDetail | null;
  previewUrl?: string;
  onOpenPath: (path: string) => Promise<unknown>;
  onOpenExternal: (url: string) => Promise<unknown>;
}) {
  const { detail, previewUrl, onOpenPath, onOpenExternal } = props;
  if (!detail) {
    return (
      <article className="summary-card coverage-detail-card">
        <p className="summary-copy">
          Select a problem to inspect solved state, test fragments, source-code coverage, and raw
          normalized record links.
        </p>
      </article>
    );
  }

  const liveMirrorUrl =
    previewUrl && detail.record.mirrorRoute
      ? new URL(detail.record.mirrorRoute, previewUrl).toString()
      : undefined;

  return (
    <article className="summary-card coverage-detail-card">
      <div className="panel-heading compact-panel-heading">
        <div>
          <p className="section-kicker">Selected problem</p>
          <h3>
            #{detail.record.problemId} {detail.record.name}
          </h3>
          <p className="summary-copy">{detail.record.slug}</p>
        </div>
        <span className="panel-chip">{detail.record.solvedByMe ? 'Solved' : 'Unsolved'}</span>
      </div>

      <CoverageDetailBadges record={detail.record} />
      <CoverageDetailMetadata record={detail.record} />

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

      <CoverageDetailActions
        detail={detail}
        liveMirrorUrl={liveMirrorUrl}
        onOpenPath={onOpenPath}
        onOpenExternal={onOpenExternal}
      />

      <p className="summary-copy">
        Mirror route: <span className="mono">{detail.record.mirrorRoute}</span>
      </p>
    </article>
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
      <td>{record.effectiveTestsAvailableCount}</td>
      <td>{record.visibleTestsCapturedCount}</td>
      <td>{officialSourceCellText(record)}</td>
      <td>{trustworthyUserSourceCellText(record)}</td>
      <td>{record.editorialAvailability}</td>
    </tr>
  );
}

function officialSourceCellText(record: GuiCoverageRecord): string {
  if (record.officialSourceArchived) {
    return (record.officialSourceLanguages ?? []).join(', ');
  }
  return humanizeOfficialSourceStatus(record.officialSourceStatus);
}

function trustworthyUserSourceCellText(record: GuiCoverageRecord): string {
  const languages = record.trustworthyUserSourceLanguages ?? [];
  if (languages.length > 0) {
    return languages.join(', ');
  }
  return record.userSourceArchived ? 'Archived only' : 'No';
}

function humanizeTestsCoverageStatus(status: GuiCoverageRecord['testsCoverageStatus']): string {
  switch (status) {
    case 'captured':
      return 'Captured';
    case 'not-available-upstream':
      return 'Not available upstream';
    case 'not-captured-yet':
      return 'Not captured yet';
    default:
      return status;
  }
}

function humanizeOfficialSourceStatus(status: GuiCoverageRecord['officialSourceStatus']): string {
  switch (status) {
    case 'archived':
      return 'Archived';
    case 'restricted-upstream':
      return 'Restricted upstream';
    case 'not-available-upstream':
      return 'Not available upstream';
    case 'not-captured-yet':
      return 'Not captured yet';
    default:
      return status;
  }
}

function humanizeArchiveState(status: GuiCoverageRecord['archiveCompletenessStatus']): string {
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'unsolved':
      return 'Unsolved';
    case 'not-archived-yet':
      return 'Not archived yet';
    case 'missing-official-source':
      return 'Missing official source';
    case 'missing-user-source':
      return 'Missing user source';
    case 'incomplete':
      return 'Incomplete';
    default:
      return status;
  }
}

function formatEvaluationMap(entries: Record<string, number>): string {
  return Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([language, evaluationId]) => `${language} -> ${evaluationId}`)
    .join(', ');
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
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
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
