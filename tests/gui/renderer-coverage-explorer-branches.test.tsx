/**
 * Covers remaining branches in src/gui/renderer/coverage-explorer.tsx:
 *   - humanizeArchiveState: 'incomplete' arm (line 691) and default arm (line 693)
 *   - formatEvaluationMap: when bestTrustworthyUserPerLanguage is non-empty (lines 697-702)
 *
 * These arms are reached by rendering CoverageExplorerPanel with a detail record
 * whose archiveCompletenessStatus is 'incomplete' and bestTrustworthyUserPerLanguage
 * has at least one entry.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { CoverageExplorerPanel } from '../../src/gui/renderer/coverage-explorer.js';
import type { CoverageExplorerFilters } from '../../src/gui/renderer/coverage-explorer.js';
import type { GuiCoverageDetail, GuiCoverageRecord } from '../../src/gui/shared/types.js';

afterEach(() => {
  cleanup();
});

const baseFilters: CoverageExplorerFilters = {
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

function makeRecord(
  overrides: Partial<GuiCoverageRecord> & { problemId: number; slug: string; name: string },
): GuiCoverageRecord {
  return {
    grade: 9,
    mirrorRoute: `/probleme/${overrides.problemId}/${overrides.slug}`,
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
    testsCoverageStatus: 'not-captured-yet',
    officialSolutionPresent: false,
    officialSourceArchived: false,
    officialSourceLanguages: [],
    officialSourceStatus: 'not-captured-yet',
    userSourceArchived: false,
    userSourceLanguages: [],
    requiredTrustworthyUserSourceLanguages: [],
    trustworthyUserSourceLanguages: [],
    bestTrustworthyUserPerLanguage: {},
    missingTrustworthyUserSourceLanguages: [],
    archiveCompletenessStatus: 'not-archived-yet',
    editorialAvailability: 'unknown',
    testsAvailable: false,
    unsolvedByConfiguredHandle: true,
    officialSourceBlocked: false,
    notArchivedYet: true,
    newSinceBaseline: false,
    notes: [],
    ...overrides,
  };
}

function makeDetail(record: GuiCoverageRecord): GuiCoverageDetail {
  return {
    snapshotId: 'test-snap',
    record: {
      ...record,
      canonicalUrl: `https://www.pbinfo.ro/probleme/${record.problemId}/${record.slug}`,
      statementArchived: false,
      solutionFragmentArchived: false,
      officialSourceCount: 0,
      userSourceCount: 0,
      hasAnyArchivedSource: false,
      evaluationIds: [],
    },
    coverageFilePath: `/ws/archive/snapshots/test-snap/normalized/problem-coverage/problem-${record.problemId}.json`,
    rawRecordLinks: {
      coverageFilePath: `/ws/normalized/problem-coverage/problem-${record.problemId}.json`,
      problemFilePath: `/ws/normalized/problems/problem-${record.problemId}.json`,
      rankingFilePath: undefined,
      evaluationFilePaths: [],
      officialSourceFilePaths: [],
      userSourceFilePaths: [],
    },
  };
}

describe('humanizeArchiveState incomplete arm (line 691)', () => {
  test('renders "Missing tests" label for archiveCompletenessStatus incomplete', () => {
    const record = makeRecord({
      problemId: 42,
      slug: 'half-done',
      name: 'Half Done',
      archiveCompletenessStatus: 'incomplete',
      solvedByMe: true,
      trustworthyUserSourceLanguages: ['c'],
      bestTrustworthyUserPerLanguage: { c: 99 },
    });
    const detail = makeDetail(record);

    render(
      <CoverageExplorerPanel
        snapshotId="test-snap"
        summary={null}
        listing={null}
        detail={detail}
        selectedProblemId={42}
        filters={baseFilters}
        onFiltersChange={vi.fn()}
        onSelectProblem={vi.fn()}
        onOpenPath={vi.fn()}
        onOpenExternal={vi.fn()}
      />,
    );

    // humanizeArchiveState('incomplete') → 'Incomplete' (line 691 in coverage-explorer.tsx)
    const incompleteElements = screen.getAllByText('Incomplete');
    expect(incompleteElements.length).toBeGreaterThanOrEqual(1);
    // formatEvaluationMap({ c: 99 }) → 'c -> 99' (lines 697-702 in coverage-explorer.tsx)
    expect(screen.getByText('c -> 99')).toBeInTheDocument();
  });
});

describe('humanizeArchiveState default arm (line 693)', () => {
  test('renders the status string verbatim for unknown archiveCompletenessStatus', () => {
    const record = makeRecord({
      problemId: 43,
      slug: 'unknown-state',
      name: 'Unknown State',
      // Cast through unknown to simulate an unexpected enum value arriving at runtime
      archiveCompletenessStatus: 'future-unknown-state' as GuiCoverageRecord['archiveCompletenessStatus'],
    });
    const detail = makeDetail(record);

    render(
      <CoverageExplorerPanel
        snapshotId="test-snap"
        summary={null}
        listing={null}
        detail={detail}
        selectedProblemId={43}
        filters={baseFilters}
        onFiltersChange={vi.fn()}
        onSelectProblem={vi.fn()}
        onOpenPath={vi.fn()}
        onOpenExternal={vi.fn()}
      />,
    );

    // humanizeArchiveState default → returns the status string as-is (line 693)
    expect(screen.getByText('future-unknown-state')).toBeInTheDocument();
  });
});

describe('formatEvaluationMap with multiple languages (lines 697-702)', () => {
  test('renders sorted language->evaluationId pairs for bestTrustworthyUserPerLanguage', () => {
    const record = makeRecord({
      problemId: 44,
      slug: 'multi-lang',
      name: 'Multi Language',
      archiveCompletenessStatus: 'complete',
      solvedByMe: true,
      trustworthyUserSourceLanguages: ['cpp', 'c'],
      bestTrustworthyUserPerLanguage: { cpp: 200, c: 100 },
    });
    const detail = makeDetail(record);

    render(
      <CoverageExplorerPanel
        snapshotId="test-snap"
        summary={null}
        listing={null}
        detail={detail}
        selectedProblemId={44}
        filters={baseFilters}
        onFiltersChange={vi.fn()}
        onSelectProblem={vi.fn()}
        onOpenPath={vi.fn()}
        onOpenExternal={vi.fn()}
      />,
    );

    // formatEvaluationMap sorts by language key: c before cpp
    // Lines 697-702: entries sorted, mapped to "lang -> id", joined by ", "
    expect(screen.getByText('c -> 100, cpp -> 200')).toBeInTheDocument();
  });
});

describe('humanizeArchiveState remaining arms: unsolved, not-archived-yet, missing-official-source', () => {
  test.each([
    ['unsolved', 'Unsolved'],
    ['not-archived-yet', 'Not archived yet'],
    ['missing-official-source', 'Missing official source'],
  ] as const)(
    'renders "%s" label for archiveCompletenessStatus %s',
    (status, expectedLabel) => {
      const record = makeRecord({
        problemId: 50,
        slug: 'state-test',
        name: 'State Test',
        archiveCompletenessStatus: status,
      });
      const detail = makeDetail(record);

      render(
        <CoverageExplorerPanel
          snapshotId="test-snap"
          summary={null}
          listing={null}
          detail={detail}
          selectedProblemId={50}
          filters={baseFilters}
          onFiltersChange={vi.fn()}
          onSelectProblem={vi.fn()}
          onOpenPath={vi.fn()}
          onOpenExternal={vi.fn()}
        />,
      );

      const elements = screen.getAllByText(expectedLabel);
      expect(elements.length).toBeGreaterThanOrEqual(1);

      cleanup();
    },
  );
});

describe('humanizeOfficialSourceStatus archived and restricted-upstream arms (lines 666, 668)', () => {
  test.each([
    ['archived', 'Archived'],
    ['restricted-upstream', 'Restricted upstream'],
  ] as const)(
    'renders "%s" label for officialSourceStatus %s in the listing',
    (status, expectedLabel) => {
      const record = makeRecord({
        problemId: 60,
        slug: 'official-status-test',
        name: 'Official Status Test',
        // Cast allows setting officialSourceStatus independently for this branch test.
        officialSourceStatus: status as GuiCoverageRecord['officialSourceStatus'],
        officialSourceArchived: false,
      });

      render(
        <CoverageExplorerPanel
          snapshotId="test-snap"
          summary={null}
          listing={{
            snapshotId: 'test-snap',
            totalCount: 1,
            offset: 0,
            limit: 100,
            items: [record],
          }}
          detail={null}
          selectedProblemId={null}
          filters={baseFilters}
          onFiltersChange={vi.fn()}
          onSelectProblem={vi.fn()}
          onOpenPath={vi.fn()}
          onOpenExternal={vi.fn()}
        />,
      );

      const elements = screen.getAllByText(expectedLabel);
      expect(elements.length).toBeGreaterThanOrEqual(1);

      cleanup();
    },
  );
});

describe('humanizeTestsCoverageStatus default arm (line 659)', () => {
  test('renders the status string verbatim for an unknown testsCoverageStatus in the detail panel', () => {
    // humanizeTestsCoverageStatus is called from CoverageDetailBadges (detail panel).
    // We must provide the record via the detail prop to exercise line 659.
    const record = makeRecord({
      problemId: 61,
      slug: 'tests-status-unknown',
      name: 'Tests Status Unknown',
      testsCoverageStatus: 'future-tests-status' as GuiCoverageRecord['testsCoverageStatus'],
    });
    const detail = makeDetail(record);

    render(
      <CoverageExplorerPanel
        snapshotId="test-snap"
        summary={null}
        listing={null}
        detail={detail}
        selectedProblemId={61}
        filters={baseFilters}
        onFiltersChange={vi.fn()}
        onSelectProblem={vi.fn()}
        onOpenPath={vi.fn()}
        onOpenExternal={vi.fn()}
      />,
    );

    // humanizeTestsCoverageStatus default → returns status string (line 659)
    expect(screen.getByText(/future-tests-status/)).toBeInTheDocument();
  });
});

describe('humanizeOfficialSourceStatus default arm (line 674)', () => {
  test('returns the status string verbatim for an unknown officialSourceStatus in the coverage list', () => {
    // officialSourceCellText is called from CoverageRow (in the listing table), not the detail panel.
    // We need the record in the listing.items to exercise line 674.
    const record = makeRecord({
      problemId: 55,
      slug: 'unknown-official',
      name: 'Unknown Official Status',
      // Cast to simulate a future unknown enum value arriving at runtime
      officialSourceStatus: 'future-unknown-status' as GuiCoverageRecord['officialSourceStatus'],
    });

    render(
      <CoverageExplorerPanel
        snapshotId="test-snap"
        summary={null}
        listing={{
          snapshotId: 'test-snap',
          totalCount: 1,
          offset: 0,
          limit: 100,
          items: [record],
        }}
        detail={null}
        selectedProblemId={null}
        filters={baseFilters}
        onFiltersChange={vi.fn()}
        onSelectProblem={vi.fn()}
        onOpenPath={vi.fn()}
        onOpenExternal={vi.fn()}
      />,
    );

    // humanizeOfficialSourceStatus default → returns status string (line 674)
    // CoverageRow calls officialSourceCellText → humanizeOfficialSourceStatus for non-archived
    expect(screen.getByText('future-unknown-status')).toBeInTheDocument();
  });
});
