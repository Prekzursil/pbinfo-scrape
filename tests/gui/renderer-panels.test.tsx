import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { CoverageExplorerPanel, type CoverageExplorerFilters } from '../../src/gui/renderer/coverage-explorer.js';
import { DataExplorerPanel } from '../../src/gui/renderer/data-explorer.js';
import type {
  GuiArchiveListing,
  GuiArchiveRecordDetail,
  GuiCoverageDetail,
  GuiCoverageListing,
  GuiCoverageRecord,
} from '../../src/gui/shared/types.js';

afterEach(() => {
  cleanup();
});

const noop = vi.fn(async () => undefined);

const baseRecord: GuiCoverageRecord = {
  problemId: 42,
  slug: 'demo',
  name: 'Demo',
  grade: 9,
  mirrorRoute: '/probleme/42/demo',
  tags: [],
  solvedByMe: false,
  evaluationCount: 0,
  solvedEvaluationCount: 0,
  rankingPresent: false,
  testsFragmentArchived: false,
  exampleTestsAvailableCount: 0,
  visibleTestsCapturedCount: 0,
  evaluationObservedTestsCount: 0,
  effectiveTestsAvailableCount: 0,
  testsCoverageStatus: 'bogus' as GuiCoverageRecord['testsCoverageStatus'],
  officialSolutionPresent: false,
  officialSourceArchived: false,
  officialSourceLanguages: [],
  officialSourceStatus: 'bogus' as GuiCoverageRecord['officialSourceStatus'],
  userSourceArchived: false,
  userSourceLanguages: [],
  requiredTrustworthyUserSourceLanguages: [],
  trustworthyUserSourceLanguages: [],
  bestTrustworthyUserPerLanguage: {},
  missingTrustworthyUserSourceLanguages: [],
  archiveCompletenessStatus: 'bogus' as GuiCoverageRecord['archiveCompletenessStatus'],
  editorialAvailability: 'unknown',
  testsAvailable: false,
  unsolvedByConfiguredHandle: true,
  officialSourceBlocked: false,
  notArchivedYet: false,
  newSinceBaseline: false,
  notes: [],
};

const filters: CoverageExplorerFilters = {
  query: '',
  solved: 'all',
  testsFragmentArchived: 'all',
  visibleTestsCaptured: 'all',
  testsCoverageStatus: 'all',
  officialSourceArchived: 'all',
  userSourceArchived: 'all',
  editorialAvailability: 'all',
  archiveCompletenessStatus: 'all',
};

describe('CoverageExplorerPanel direct render', () => {
  test('renders fallbacks when summary, listing, and detail are absent', () => {
    render(
      <CoverageExplorerPanel
        snapshotId="s"
        summary={null}
        listing={null}
        detail={null}
        selectedProblemId={null}
        filters={filters}
        onFiltersChange={vi.fn()}
        onSelectProblem={vi.fn()}
        onOpenPath={noop}
        onOpenExternal={noop}
      />,
    );
    expect(screen.getByText('No problems match the current coverage filters.')).toBeInTheDocument();
    expect(screen.getByText(/Select a problem to inspect/)).toBeInTheDocument();
  });

  test('renders an unusual record through the table and detail default branches', () => {
    const listing: GuiCoverageListing = {
      snapshotId: 's',
      totalCount: 1,
      offset: 0,
      limit: 100,
      items: [{ ...baseRecord, grade: undefined }],
    };
    const detail: GuiCoverageDetail = {
      snapshotId: 's',
      coverageFilePath: '/c.json',
      record: baseRecord,
      rawRecordLinks: {
        coverageFilePath: '/c.json',
        problemFilePath: '/p.json',
        rankingFilePath: undefined,
        evaluationFilePaths: [],
        officialSourceFilePaths: [],
        userSourceFilePaths: [],
      },
    } as unknown as GuiCoverageDetail;
    const onSelectProblem = vi.fn();
    render(
      <CoverageExplorerPanel
        snapshotId="s"
        summary={null}
        listing={listing}
        detail={detail}
        selectedProblemId={42}
        filters={filters}
        onFiltersChange={vi.fn()}
        onSelectProblem={onSelectProblem}
        onOpenPath={noop}
        onOpenExternal={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /#42 Demo/ }));
    expect(onSelectProblem).toHaveBeenCalledWith(42);
    // Ranking / evaluation / live-mirror / source-list buttons are disabled here.
    expect(screen.getByRole('button', { name: 'Open ranking record' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open first evaluation record' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open in live mirror' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open source list upstream' })).toBeDisabled();
  });

  test('renders coverage rows for every official-source and trustworthy variant', () => {
    const items: GuiCoverageRecord[] = [
      { ...baseRecord, problemId: 1, officialSourceArchived: true, officialSourceLanguages: ['cpp'] },
      { ...baseRecord, problemId: 2, trustworthyUserSourceLanguages: ['cpp'] },
      { ...baseRecord, problemId: 3, userSourceArchived: true },
      { ...baseRecord, problemId: 4, officialSourceStatus: 'restricted-upstream' as GuiCoverageRecord['officialSourceStatus'] },
      { ...baseRecord, problemId: 5, officialSourceStatus: 'not-available-upstream' as GuiCoverageRecord['officialSourceStatus'] },
      { ...baseRecord, problemId: 6, officialSourceArchived: true, officialSourceLanguages: undefined } as unknown as GuiCoverageRecord,
      { ...baseRecord, problemId: 7, trustworthyUserSourceLanguages: undefined } as unknown as GuiCoverageRecord,
      { ...baseRecord, problemId: 8, officialSourceStatus: 'archived' as GuiCoverageRecord['officialSourceStatus'] },
    ];
    render(
      <CoverageExplorerPanel
        snapshotId="s"
        summary={null}
        listing={{ snapshotId: 's', totalCount: items.length, offset: 0, limit: 100, items }}
        detail={null}
        selectedProblemId={null}
        filters={filters}
        onFiltersChange={vi.fn()}
        onSelectProblem={vi.fn()}
        onOpenPath={noop}
        onOpenExternal={noop}
      />,
    );
    expect(screen.getByText('Archived only')).toBeInTheDocument();
    expect(screen.getByText('Restricted upstream')).toBeInTheDocument();
  });

  test.each([
    ['unsolved', 'not-available-upstream'],
    ['not-archived-yet', 'not-captured-yet'],
    ['missing-official-source', 'captured'],
    ['incomplete', 'captured'],
  ] as const)(
    'humanizes archive state %s and tests status %s in the detail panel',
    (archiveState, testsStatus) => {
      const detail = {
        snapshotId: 's',
        coverageFilePath: '/c.json',
        record: {
          ...baseRecord,
          archiveCompletenessStatus: archiveState as GuiCoverageRecord['archiveCompletenessStatus'],
          testsCoverageStatus: testsStatus as GuiCoverageRecord['testsCoverageStatus'],
          officialSourceStatus: 'restricted-upstream' as GuiCoverageRecord['officialSourceStatus'],
        },
        rawRecordLinks: {
          coverageFilePath: '/c.json',
          problemFilePath: '/p.json',
          rankingFilePath: undefined,
          evaluationFilePaths: [],
          officialSourceFilePaths: [],
          userSourceFilePaths: [],
        },
      } as unknown as GuiCoverageDetail;
      render(
        <CoverageExplorerPanel
          snapshotId="s"
          summary={null}
          listing={null}
          detail={detail}
          selectedProblemId={42}
          filters={filters}
          onFiltersChange={vi.fn()}
          onSelectProblem={vi.fn()}
          onOpenPath={noop}
          onOpenExternal={noop}
        />,
      );
      expect(screen.getAllByText(/Archive state:/).length).toBeGreaterThanOrEqual(1);
      cleanup();
    },
  );
});

describe('DataExplorerPanel direct render', () => {
  test('renders fallbacks when paths, listing, and detail are absent', () => {
    render(
      <DataExplorerPanel
        snapshotId="s"
        datasetSummaries={[]}
        selectedDataset="problems"
        selectedRecordId={null}
        archiveQuery=""
        listing={null}
        detail={null}
        onDatasetChange={vi.fn()}
        onArchiveQueryChange={vi.fn()}
        onSelectRecord={vi.fn()}
        onOpenPath={noop}
        onOpenExternal={noop}
      />,
    );
    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/No records are available/)).toBeInTheDocument();
    expect(screen.getByText(/Select a record to inspect/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open normalized archive folder' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open mirror in browser' })).toBeDisabled();
  });

  test('renders records and a detail without subtitle or mirror route', () => {
    const listing: GuiArchiveListing = {
      snapshotId: 's',
      dataset: 'problems',
      totalCount: 1,
      offset: 0,
      limit: 24,
      items: [{ dataset: 'problems', recordId: 'r1', title: 'Bare record', filePath: '/r1.json' }],
    };
    const detail: GuiArchiveRecordDetail = {
      snapshotId: 's',
      dataset: 'problems',
      recordId: 'r1',
      title: 'Bare record',
      filePath: '/r1.json',
      payload: { id: 1 },
    } as unknown as GuiArchiveRecordDetail;
    const onSelectRecord = vi.fn();
    render(
      <DataExplorerPanel
        snapshotId="s"
        datasetSummaries={[]}
        selectedDataset="problems"
        selectedRecordId="r1"
        archiveQuery=""
        listing={listing}
        detail={detail}
        onDatasetChange={vi.fn()}
        onArchiveQueryChange={vi.fn()}
        onSelectRecord={onSelectRecord}
        onOpenPath={noop}
        onOpenExternal={noop}
      />,
    );
    fireEvent.click(screen.getByRole('listitem'));
    expect(onSelectRecord).toHaveBeenCalledWith('r1');
    expect(screen.getByRole('button', { name: 'Open record route in live mirror' })).toBeDisabled();
  });
});
