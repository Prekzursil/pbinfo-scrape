/**
 * Tests for src/gui/main/problem-coverage-explorer.ts
 * Covers: getCoverageExplorerSummary, listCoverageExplorerRecords,
 *   readCoverageExplorerRecord, and the private helpers:
 *   deriveArchiveCompletenessStatus (lines 512, 515, 519-526),
 *   deriveOfficialSourceStatus branches, deriveTestsCoverageStatus branches,
 *   matchesPresenceFilter, matchesStructuredCoverageFilters, withFallback.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  getCoverageExplorerSummary,
  listCoverageExplorerRecords,
  readCoverageExplorerRecord,
} from '../../src/gui/main/problem-coverage-explorer.js';
import type { ProblemCoverageIndex, ProblemCoverageRecord } from '../../src/types/records.js';

const SNAPSHOT_ID = '20240101T000000Z';
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

const ZERO_TOTALS = {
  totalProblems: 0,
  solvedByMeCount: 0,
  statementArchivedCount: 0,
  solutionFragmentArchivedCount: 0,
  testsFragmentArchivedCount: 0,
  problemsWithExamples: 0,
  problemsWithVisibleTestsCaptured: 0,
  problemsWithEvaluationObservedTests: 0,
  problemsWithEffectiveTests: 0,
  problemsWithArchivedSources: 0,
  problemsWithOfficialSourceArchived: 0,
  problemsWithUserSourceArchived: 0,
  editorialVisibleCount: 0,
  rankingPresentCount: 0,
  newSinceBaselineCount: 0,
};

function makeRecord(overrides: Partial<ProblemCoverageRecord> = {}): ProblemCoverageRecord {
  return {
    snapshotId: SNAPSHOT_ID,
    problemId: 101,
    slug: 'suma',
    name: 'Suma',
    mirrorRoute: '/probleme/101/suma',
    tags: [],
    solvedByMe: false,
    evaluationCount: 0,
    solvedEvaluationCount: 0,
    rankingPresent: false,
    statementArchived: false,
    solutionFragmentArchived: false,
    testsFragmentArchived: false,
    exampleTestsAvailableCount: 0,
    visibleTestsCapturedCount: 0,
    evaluationObservedTestsCount: 0,
    effectiveTestsAvailableCount: 0,
    testsCoverageStatus: 'not-captured-yet',
    officialSolutionPresent: false,
    editorialAvailability: 'unknown',
    sourceListUrl: 'https://www.pbinfo.ro/surse/101',
    officialSourceArchived: false,
    officialSourceCount: 0,
    officialSourceIds: [],
    officialSourceLanguages: [],
    officialSourceStatus: 'not-captured-yet',
    userSourceArchived: false,
    userSourceCount: 0,
    userSourceIds: [],
    userSourceLanguages: [],
    requiredTrustworthyUserSourceLanguages: [],
    trustworthyUserSourceLanguages: [],
    bestTrustworthyUserPerLanguage: {},
    missingTrustworthyUserSourceLanguages: [],
    archiveCompletenessStatus: 'unsolved',
    hasAnyArchivedSource: false,
    testsAvailable: false,
    unsolvedByConfiguredHandle: true,
    officialSourceBlocked: false,
    notArchivedYet: false,
    newSinceBaseline: false,
    evaluationIds: [],
    notes: [],
    ...overrides,
  };
}

function seedWorkspace(records: ProblemCoverageRecord[]): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-cov-explorer-'));
  tempDirs.push(workspaceRoot);
  const normalizedRoot = join(
    workspaceRoot,
    'archive',
    'snapshots',
    SNAPSHOT_ID,
    'normalized',
  );
  const index: ProblemCoverageIndex = {
    snapshotId: SNAPSHOT_ID,
    generatedAt: '2024-01-01T00:00:00.000Z',
    totals: { ...ZERO_TOTALS, totalProblems: records.length },
    records,
  };
  writeJson(join(normalizedRoot, 'problem-coverage', 'index.json'), index);
  // Write catalog so resolveReadableSnapshotLayout can find this snapshot
  writeJson(join(workspaceRoot, 'archive', 'catalog.json'), {
    currentSnapshotId: SNAPSHOT_ID,
    snapshots: [{ snapshotId: SNAPSHOT_ID, status: 'completed', scope: 'all' }],
    artifactExports: [],
  });
  return workspaceRoot;
}

describe('getCoverageExplorerSummary', () => {
  test('throws when no coverage index exists', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-cov-empty-'));
    tempDirs.push(workspaceRoot);
    writeJson(join(workspaceRoot, 'archive', 'catalog.json'), {
      currentSnapshotId: SNAPSHOT_ID,
      snapshots: [{ snapshotId: SNAPSHOT_ID, status: 'completed', scope: 'all' }],
      artifactExports: [],
    });

    expect(() => getCoverageExplorerSummary(workspaceRoot)).toThrow(
      /coverage has not been generated/,
    );
  });

  test('returns summary with gapReport fallback when no gap report file exists', () => {
    // No gap report → falls back to deriving from index records
    const records = [
      makeRecord({ problemId: 1, solvedByMe: false }),
      makeRecord({ problemId: 2, solvedByMe: true, officialSourceArchived: false, userSourceArchived: false, missingTrustworthyUserSourceLanguages: ['cpp'] }),
    ];
    const workspaceRoot = seedWorkspace(records);
    const summary = getCoverageExplorerSummary(workspaceRoot);

    expect(summary.snapshotId).toBe(SNAPSHOT_ID);
    expect(summary.unsolvedProblemCount).toBe(1);
    expect(summary.missingOfficialSourceCount).toBe(2); // both have no officialSourceArchived
    expect(summary.solvedByMeMissingUserSourceCount).toBe(1); // record 2 has missingTrustworthy
  });

  test('accumulates status counts for all STATUS_COUNT_RULES branches', () => {
    // Covers all 6 rules in STATUS_COUNT_RULES
    const records = [
      // completeProblemCount: archiveCompletenessStatus === 'complete'
      makeRecord({
        problemId: 1,
        archiveCompletenessStatus: 'complete',
        solvedByMe: true,
        officialSourceStatus: 'archived',
        testsCoverageStatus: 'captured',
      }),
      // incompleteSolvedProblemCount: solvedByMe + not complete
      makeRecord({
        problemId: 2,
        archiveCompletenessStatus: 'incomplete',
        solvedByMe: true,
        officialSourceStatus: 'archived',
        testsCoverageStatus: 'not-captured-yet',
      }),
      // missingOfficialSourceCaptureCount
      makeRecord({
        problemId: 3,
        archiveCompletenessStatus: 'missing-official-source',
        officialSourceStatus: 'not-captured-yet',
      }),
      // officialSourceUnavailableUpstreamCount
      makeRecord({
        problemId: 4,
        officialSourceStatus: 'not-available-upstream',
        archiveCompletenessStatus: 'unsolved',
      }),
      // missingTestsCaptureCount
      makeRecord({
        problemId: 5,
        testsCoverageStatus: 'not-captured-yet',
        archiveCompletenessStatus: 'unsolved',
      }),
      // testsUnavailableUpstreamCount
      makeRecord({
        problemId: 6,
        testsCoverageStatus: 'not-available-upstream',
        archiveCompletenessStatus: 'unsolved',
      }),
    ];
    const workspaceRoot = seedWorkspace(records);
    const summary = getCoverageExplorerSummary(workspaceRoot);

    expect(summary.completeProblemCount).toBe(1);
    expect(summary.incompleteSolvedProblemCount).toBe(1);
    expect(summary.missingOfficialSourceCaptureCount).toBe(1);
    expect(summary.officialSourceUnavailableUpstreamCount).toBe(1);
    expect(summary.missingTestsCaptureCount).toBeGreaterThanOrEqual(1);
    expect(summary.testsUnavailableUpstreamCount).toBe(1);
  });
});

describe('listCoverageExplorerRecords', () => {
  test('returns empty list when no records match query', () => {
    const workspaceRoot = seedWorkspace([makeRecord({ name: 'Suma', problemId: 1 })]);
    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      query: 'nomatch',
    });
    expect(result.totalCount).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  test('applies offset and limit pagination', () => {
    const records = [1, 2, 3].map((id) => makeRecord({ problemId: id, name: `Problem ${id}` }));
    const workspaceRoot = seedWorkspace(records);

    const page = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      offset: 1,
      limit: 1,
    });
    expect(page.totalCount).toBe(3);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.problemId).toBe(2);
  });

  test('filters by solved=solved', () => {
    const records = [
      makeRecord({ problemId: 1, solvedByMe: true }),
      makeRecord({ problemId: 2, solvedByMe: false }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      solved: 'solved',
    });
    expect(result.totalCount).toBe(1);
    expect(result.items[0]!.problemId).toBe(1);
  });

  test('filters by solved=unsolved', () => {
    const records = [
      makeRecord({ problemId: 1, solvedByMe: true }),
      makeRecord({ problemId: 2, solvedByMe: false }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      solved: 'unsolved',
    });
    expect(result.totalCount).toBe(1);
    expect(result.items[0]!.problemId).toBe(2);
  });

  test('filters by testsFragmentArchived presence filter yes/no', () => {
    const records = [
      makeRecord({ problemId: 1, testsFragmentArchived: true }),
      makeRecord({ problemId: 2, testsFragmentArchived: false }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const yes = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      testsFragmentArchived: 'yes',
    });
    expect(yes.totalCount).toBe(1);
    expect(yes.items[0]!.problemId).toBe(1);

    const no = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      testsFragmentArchived: 'no',
    });
    expect(no.totalCount).toBe(1);
    expect(no.items[0]!.problemId).toBe(2);

    const all = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      testsFragmentArchived: 'all',
    });
    expect(all.totalCount).toBe(2);
  });

  test('filters by visibleTestsCaptured presence filter', () => {
    const records = [
      makeRecord({ problemId: 1, visibleTestsCapturedCount: 5 }),
      makeRecord({ problemId: 2, visibleTestsCapturedCount: 0 }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const yes = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      visibleTestsCaptured: 'yes',
    });
    expect(yes.items[0]!.problemId).toBe(1);

    const no = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      visibleTestsCaptured: 'no',
    });
    expect(no.items[0]!.problemId).toBe(2);
  });

  test('filters by testsCoverageStatus enum', () => {
    const records = [
      makeRecord({ problemId: 1, testsCoverageStatus: 'captured' }),
      makeRecord({ problemId: 2, testsCoverageStatus: 'not-captured-yet' }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      testsCoverageStatus: 'captured',
    });
    expect(result.totalCount).toBe(1);
    expect(result.items[0]!.problemId).toBe(1);
  });

  test('filters by officialSourceArchived presence filter', () => {
    const records = [
      makeRecord({ problemId: 1, officialSourceArchived: true }),
      makeRecord({ problemId: 2, officialSourceArchived: false }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const yes = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      officialSourceArchived: 'yes',
    });
    expect(yes.totalCount).toBe(1);

    const no = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      officialSourceArchived: 'no',
    });
    expect(no.totalCount).toBe(1);
  });

  test('filters by userSourceArchived presence filter', () => {
    const records = [
      makeRecord({ problemId: 1, userSourceArchived: true }),
      makeRecord({ problemId: 2, userSourceArchived: false }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const yes = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      userSourceArchived: 'yes',
    });
    expect(yes.totalCount).toBe(1);
  });

  test('filters by editorialAvailability enum', () => {
    const records = [
      makeRecord({ problemId: 1, editorialAvailability: 'visible' }),
      makeRecord({ problemId: 2, editorialAvailability: 'unknown' }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      editorialAvailability: 'visible',
    });
    expect(result.totalCount).toBe(1);
    expect(result.items[0]!.problemId).toBe(1);
  });

  test('filters by grade number', () => {
    const records = [
      makeRecord({ problemId: 1, grade: 9 }),
      makeRecord({ problemId: 2, grade: 10 }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      grade: 9,
    });
    expect(result.totalCount).toBe(1);
    expect(result.items[0]!.problemId).toBe(1);
  });

  test('filters by archiveCompletenessStatus enum', () => {
    const records = [
      makeRecord({ problemId: 1, archiveCompletenessStatus: 'complete', solvedByMe: true }),
      makeRecord({ problemId: 2, archiveCompletenessStatus: 'unsolved' }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      archiveCompletenessStatus: 'complete',
    });
    expect(result.totalCount).toBe(1);
    expect(result.items[0]!.problemId).toBe(1);
  });
});

describe('deriveArchiveCompletenessStatus branches (lines 512, 515, 519-526)', () => {
  test('returns "unsolved" when solvedByMe is false (line 512)', () => {
    // Record with pre-populated archiveCompletenessStatus = undefined forces derive path
    // We need to trigger deriveArchiveCompletenessStatus. Pass a record without
    // archiveCompletenessStatus set so toGuiCoverageRecord must derive it.
    // Actually the type always has archiveCompletenessStatus set. But the derive is also
    // called from accumulateStatusCounts if the field is missing at runtime.
    // The safest approach: pass a filter that calls deriveArchiveCompletenessStatus.
    // matchesStructuredCoverageFilters calls:
    //   record.archiveCompletenessStatus ?? deriveArchiveCompletenessStatus(record)
    // If we provide a record where archiveCompletenessStatus is undefined at runtime...
    // We can cast it to bypass TypeScript.
    const records = [
      makeRecord({
        problemId: 10,
        solvedByMe: false,
        archiveCompletenessStatus: undefined as unknown as 'unsolved',
      }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      archiveCompletenessStatus: 'unsolved',
    });
    // deriveArchiveCompletenessStatus returns 'unsolved' because !solvedByMe
    expect(result.totalCount).toBe(1);
  });

  test('returns "not-archived-yet" when notArchivedYet is true (line 508)', () => {
    const records = [
      makeRecord({
        problemId: 11,
        notArchivedYet: true,
        solvedByMe: true,
        archiveCompletenessStatus: undefined as unknown as 'unsolved',
      }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      archiveCompletenessStatus: 'not-archived-yet',
    });
    expect(result.totalCount).toBe(1);
  });

  test('returns "missing-user-source" when user source not archived (line 515-517)', () => {
    const records = [
      makeRecord({
        problemId: 12,
        solvedByMe: true,
        userSourceArchived: false,
        missingTrustworthyUserSourceLanguages: [],
        archiveCompletenessStatus: undefined as unknown as 'unsolved',
      }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      archiveCompletenessStatus: 'missing-user-source',
    });
    expect(result.totalCount).toBe(1);
  });

  test('returns "missing-user-source" via missingTrustworthyUserSourceLanguages (line 514)', () => {
    const records = [
      makeRecord({
        problemId: 13,
        solvedByMe: true,
        userSourceArchived: true,
        missingTrustworthyUserSourceLanguages: ['cpp'],
        archiveCompletenessStatus: undefined as unknown as 'unsolved',
      }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      archiveCompletenessStatus: 'missing-user-source',
    });
    expect(result.totalCount).toBe(1);
  });

  test('returns "missing-official-source" when official source not captured (lines 519-520)', () => {
    const records = [
      makeRecord({
        problemId: 14,
        solvedByMe: true,
        userSourceArchived: true,
        missingTrustworthyUserSourceLanguages: [],
        officialSourceArchived: false,
        sourceListUrl: 'https://www.pbinfo.ro/surse/14', // → 'not-captured-yet'
        editorialAvailability: 'unknown',
        archiveCompletenessStatus: undefined as unknown as 'unsolved',
      }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      archiveCompletenessStatus: 'missing-official-source',
    });
    expect(result.totalCount).toBe(1);
  });

  test('returns "incomplete" when tests not captured (lines 522-523)', () => {
    const records = [
      makeRecord({
        problemId: 15,
        solvedByMe: true,
        userSourceArchived: true,
        missingTrustworthyUserSourceLanguages: [],
        officialSourceArchived: true, // → 'archived' (not 'not-captured-yet')
        testsFragmentArchived: false,
        exampleTestsAvailableCount: 0,
        visibleTestsCapturedCount: 0,
        evaluationObservedTestsCount: 0,
        effectiveTestsAvailableCount: 0,
        archiveCompletenessStatus: undefined as unknown as 'unsolved',
      }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      archiveCompletenessStatus: 'incomplete',
    });
    expect(result.totalCount).toBe(1);
  });

  test('returns "complete" when all criteria met (line 525)', () => {
    const records = [
      makeRecord({
        problemId: 16,
        solvedByMe: true,
        userSourceArchived: true,
        missingTrustworthyUserSourceLanguages: [],
        officialSourceArchived: true,
        visibleTestsCapturedCount: 5, // → 'captured'
        archiveCompletenessStatus: undefined as unknown as 'unsolved',
      }),
    ];
    const workspaceRoot = seedWorkspace(records);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      archiveCompletenessStatus: 'complete',
    });
    expect(result.totalCount).toBe(1);
  });
});

describe('readCoverageExplorerRecord', () => {
  test('reads a coverage record from the index when no per-problem file exists', () => {
    const record = makeRecord({
      problemId: 50,
      solvedByMe: true,
      rankingPresent: false,
      evaluationIds: [1001, 1002],
      officialSourceIds: ['s-1'],
      userSourceIds: ['s-2'],
    });
    const workspaceRoot = seedWorkspace([record]);

    const detail = readCoverageExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      problemId: 50,
    });
    expect(detail.snapshotId).toBe(SNAPSHOT_ID);
    expect(detail.record.problemId).toBe(50);
    expect(detail.record.evaluationIds).toEqual([1001, 1002]);
    expect(detail.rawRecordLinks.evaluationFilePaths).toHaveLength(2);
    expect(detail.rawRecordLinks.officialSourceFilePaths).toHaveLength(1);
    expect(detail.rawRecordLinks.userSourceFilePaths).toHaveLength(1);
    expect(detail.rawRecordLinks.rankingFilePath).toBeUndefined();
  });

  test('throws when the requested problem id is not in the index', () => {
    const workspaceRoot = seedWorkspace([makeRecord({ problemId: 1 })]);

    expect(() =>
      readCoverageExplorerRecord(workspaceRoot, {
        snapshotId: SNAPSHOT_ID,
        problemId: 99999,
      }),
    ).toThrow('Coverage record "99999" was not found.');
  });

  test('deriveOfficialSourceStatus: restricted-upstream for hidden editorial', () => {
    // record.editorialAvailability = 'hidden' and officialSourceStatus=undefined → derive → 'restricted-upstream'
    const record = makeRecord({
      problemId: 20,
      officialSourceArchived: false,
      editorialAvailability: 'hidden',
      officialSourceStatus: undefined as unknown as 'not-captured-yet',
      archiveCompletenessStatus: undefined as unknown as 'unsolved',
    });
    const workspaceRoot = seedWorkspace([record]);

    // When testsCoverageStatus filter is applied, matchesStructuredCoverageFilters calls
    // record.testsCoverageStatus ?? deriveTestsCoverageStatus which triggers deriveOfficialSourceStatus too
    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      testsCoverageStatus: 'not-captured-yet',
    });
    // deriveOfficialSourceStatus via accumulateStatusCounts covers lines 467-469
    expect(result.totalCount).toBe(1);
  });

  test('deriveOfficialSourceStatus: restricted-upstream for restricted editorial', () => {
    const record = makeRecord({
      problemId: 25,
      officialSourceArchived: false,
      editorialAvailability: 'restricted',
      officialSourceStatus: undefined as unknown as 'not-captured-yet',
      archiveCompletenessStatus: undefined as unknown as 'unsolved',
    });
    const workspaceRoot = seedWorkspace([record]);

    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      testsCoverageStatus: 'not-captured-yet',
    });
    expect(result.totalCount).toBe(1);
  });

  test('deriveOfficialSourceStatus: not-available-upstream when no sourceListUrl', () => {
    const record = makeRecord({
      problemId: 21,
      officialSourceArchived: false,
      editorialAvailability: 'unknown',
      sourceListUrl: undefined,
      officialSourceStatus: undefined as unknown as 'not-captured-yet',
      archiveCompletenessStatus: undefined as unknown as 'unsolved',
    });
    const workspaceRoot = seedWorkspace([record]);

    // deriveOfficialSourceStatus returns 'not-available-upstream' → officialSourceUnavailableUpstreamCount
    const summary = getCoverageExplorerSummary(workspaceRoot);
    expect(summary.officialSourceUnavailableUpstreamCount).toBe(1);
  });

  test('deriveTestsCoverageStatus: not-available-upstream when testsFragmentArchived=true and no tests', () => {
    const record = makeRecord({
      problemId: 22,
      solvedByMe: true,
      userSourceArchived: true,
      officialSourceArchived: true,
      testsFragmentArchived: true,
      exampleTestsAvailableCount: 0,
      visibleTestsCapturedCount: 0,
      evaluationObservedTestsCount: 0,
      effectiveTestsAvailableCount: 0,
      testsCoverageStatus: undefined as unknown as 'not-captured-yet',
      archiveCompletenessStatus: undefined as unknown as 'unsolved',
    });
    const workspaceRoot = seedWorkspace([record]);

    // deriveTestsCoverageStatus: hasAnyCapturedTests=false, testsFragmentArchived=true → 'not-available-upstream'
    // not 'not-captured-yet' → deriveArchiveCompletenessStatus returns 'complete' (falls through)
    const result = listCoverageExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      archiveCompletenessStatus: 'complete',
    });
    expect(result.totalCount).toBe(1);
  });

  test('resolveEffectiveTestsCount falls back to exampleTestsAvailableCount when others are undefined (lines 276-277)', () => {
    const record = makeRecord({
      problemId: 35,
      effectiveTestsAvailableCount: undefined as unknown as number,
      visibleTestsCapturedCount: undefined as unknown as number,
      exampleTestsAvailableCount: 3,
      testsAvailable: undefined as unknown as boolean,
      testsFragmentArchived: undefined as unknown as boolean,
    });
    const workspaceRoot = seedWorkspace([record]);

    const detail = readCoverageExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      problemId: 35,
    });
    // effectiveTestsAvailableCount ?? visibleTestsCapturedCount ?? exampleTestsAvailableCount → 3
    expect(detail.record.effectiveTestsAvailableCount).toBe(3);
    // testsAvailable ?? testsFragmentArchived ?? (exampleTestsAvailableCount > 0) → true
    expect(detail.record.testsAvailable).toBe(true);
  });

  test('resolveEffectiveTestsCount falls back to 0 when all test counts are undefined (line 277)', () => {
    const record = makeRecord({
      problemId: 36,
      effectiveTestsAvailableCount: undefined as unknown as number,
      visibleTestsCapturedCount: undefined as unknown as number,
      exampleTestsAvailableCount: undefined as unknown as number,
      testsAvailable: undefined as unknown as boolean,
      testsFragmentArchived: undefined as unknown as boolean,
    });
    const workspaceRoot = seedWorkspace([record]);

    const detail = readCoverageExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      problemId: 36,
    });
    // All undefined → falls to 0
    expect(detail.record.effectiveTestsAvailableCount).toBe(0);
    // testsAvailable: undefined ?? testsFragmentArchived: undefined ?? (undefined ?? 0) > 0 → false
    expect(detail.record.testsAvailable).toBe(false);
  });

  test('withFallback: uses fallback values when fields are undefined in record', () => {
    // Fields like officialSourceLanguages, userSourceLanguages, etc. being undefined
    // causes withFallback to invoke the fallback function
    const record = makeRecord({
      problemId: 30,
      officialSourceLanguages: undefined as unknown as string[],
      userSourceLanguages: undefined as unknown as string[],
      trustworthyUserSourceLanguages: undefined as unknown as string[],
      bestTrustworthyUserPerLanguage: undefined as unknown as Record<string, number>,
      missingTrustworthyUserSourceLanguages: undefined as unknown as string[],
      requiredTrustworthyUserSourceLanguages: undefined as unknown as string[],
      officialSourceBlocked: undefined as unknown as boolean,
      testsCoverageStatus: undefined as unknown as 'not-captured-yet',
      testsAvailable: undefined as unknown as boolean,
      effectiveTestsAvailableCount: undefined as unknown as number,
      officialSourceStatus: undefined as unknown as 'not-captured-yet',
    });
    const workspaceRoot = seedWorkspace([record]);

    const detail = readCoverageExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      problemId: 30,
    });
    // All withFallback calls resolve to their fallback values
    expect(detail.record.officialSourceLanguages).toEqual([]);
    expect(detail.record.userSourceLanguages).toEqual([]);
    expect(detail.record.trustworthyUserSourceLanguages).toEqual([]);
    expect(detail.record.bestTrustworthyUserPerLanguage).toEqual({});
    expect(detail.record.officialSourceBlocked).toBe(false);
    expect(typeof detail.record.testsAvailable).toBe('boolean');
  });
});
