import type {
  ProblemCoverageIndex,
  ProblemCoverageRecord,
  ProblemCoverageTotals,
} from '../../src/types/records.js';

export function makeCoverageRecord(
  overrides: Partial<ProblemCoverageRecord> & { problemId: number },
): ProblemCoverageRecord {
  return {
    snapshotId: 'SNAP',
    slug: `problem-${overrides.problemId}`,
    name: `Problem ${overrides.problemId}`,
    grade: 9,
    canonicalUrl: `https://www.pbinfo.ro/probleme/${overrides.problemId}/slug`,
    mirrorRoute: `/probleme/${overrides.problemId}/slug`,
    tags: [],
    solvedByMe: false,
    evaluationCount: 0,
    solvedEvaluationCount: 0,
    rankingPresent: false,
    statementArchived: true,
    solutionFragmentArchived: false,
    testsFragmentArchived: false,
    exampleTestsAvailableCount: 0,
    visibleTestsCapturedCount: 0,
    evaluationObservedTestsCount: 0,
    effectiveTestsAvailableCount: 0,
    testsCoverageStatus: 'not-captured-yet',
    officialSolutionPresent: false,
    editorialAvailability: 'unknown',
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

export function makeCoverageTotals(
  overrides: Partial<ProblemCoverageTotals> = {},
): ProblemCoverageTotals {
  return {
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
    ...overrides,
  };
}

export function makeCoverageIndex(
  records: ProblemCoverageRecord[],
  overrides: Partial<ProblemCoverageIndex> = {},
): ProblemCoverageIndex {
  return {
    snapshotId: 'SNAP',
    generatedAt: '2026-01-01T00:00:00.000Z',
    totals: makeCoverageTotals({ totalProblems: records.length }),
    records,
    ...overrides,
  };
}
