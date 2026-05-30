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
