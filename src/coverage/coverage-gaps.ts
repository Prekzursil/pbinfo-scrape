import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeJsonRecord } from '../archive/json-store.js';
import type {
  ProblemCoverageIndex,
  ProblemCoverageRecord,
} from '../types/records.js';

export type OfficialSourceBlockedReason =
  | 'editorial-hidden'
  | 'editorial-restricted'
  | 'not-available-upstream'
  | 'solution-fragment-not-archived'
  | 'official-source-not-captured'
  | 'unknown';

export interface ProblemCoverageGapEntry {
  problemId: number;
  slug: string;
  name: string;
  mirrorRoute: string;
  solvedByMe: boolean;
  officialSourceArchived: boolean;
  userSourceArchived: boolean;
  missingTrustworthyUserSourceLanguages?: string[];
  blockedReason?: OfficialSourceBlockedReason;
  evidence: {
    sourceListUrl?: string;
    editorialAvailability: ProblemCoverageRecord['editorialAvailability'];
    statementArchived: boolean;
    solutionFragmentArchived: boolean;
    testsFragmentArchived: boolean;
    officialSolutionPresent: boolean;
    effectiveTestsAvailableCount: number;
    testsCoverageStatus: ProblemCoverageRecord['testsCoverageStatus'];
    officialSourceStatus: ProblemCoverageRecord['officialSourceStatus'];
    officialSourceLanguages: string[];
    userSourceLanguages: string[];
    requiredTrustworthyUserSourceLanguages: string[];
    trustworthyUserSourceLanguages: string[];
    bestTrustworthyUserPerLanguage: Record<string, number>;
    archiveCompletenessStatus: ProblemCoverageRecord['archiveCompletenessStatus'];
    notes: string[];
  };
}

export interface CoverageHardGateStatus {
  passed: boolean;
  failedProblemIds: number[];
  failureCount: number;
}

export interface ProblemCoverageGapReport {
  snapshotId: string;
  generatedAt: string;
  paths: {
    reportPath: string;
    unsolvedPath: string;
    missingOfficialPath: string;
    missingSolvedUserSourcePath: string;
    noTestsPath: string;
    exampleOnlyPath: string;
    visibleTestsPath: string;
    newSinceBaselinePath: string;
  };
  totals: {
    totalProblems: number;
    solvedByMeCount: number;
    unsolvedCount: number;
    missingOfficialSourceCount: number;
    solvedByMeMissingUserSourceCount: number;
    noTestsCount: number;
    exampleOnlyCount: number;
    visibleTestsPresentCount: number;
    newSinceBaselineCount: number;
  };
  gates: {
    officialSourceGate: CoverageHardGateStatus;
    solvedUserSourceGate: CoverageHardGateStatus;
  };
  unsolvedProblemIds: number[];
  missingOfficialSources: ProblemCoverageGapEntry[];
  solvedByMeMissingUserSource: ProblemCoverageGapEntry[];
  noTestsProblemIds: number[];
  exampleOnlyProblemIds: number[];
  visibleTestsPresentProblemIds: number[];
  newSinceBaselineProblemIds: number[];
}

function isSolvedByMeMissingUserSource(record: ProblemCoverageRecord): boolean {
  if (!record.solvedByMe) {
    return false;
  }
  const missingLanguages = (record.missingTrustworthyUserSourceLanguages?.length ?? 0) > 0;
  const unknownUserSource =
    !record.userSourceArchived && !('missingTrustworthyUserSourceLanguages' in record);
  return missingLanguages || unknownUserSource;
}

function hasGapTestsAvailable(record: ProblemCoverageRecord): boolean {
  return record.testsAvailable ?? hasAnyGapTestCount(record);
}

function hasAnyGapTestCount(record: ProblemCoverageRecord): boolean {
  return (
    record.effectiveTestsAvailableCount > 0 ||
    record.exampleTestsAvailableCount > 0 ||
    record.visibleTestsCapturedCount > 0 ||
    record.evaluationObservedTestsCount > 0
  );
}

function isExampleOnly(record: ProblemCoverageRecord): boolean {
  return (
    record.exampleTestsAvailableCount > 0 &&
    record.visibleTestsCapturedCount === 0 &&
    record.evaluationObservedTestsCount === 0
  );
}

const OFFICIAL_SOURCE_GATE_FAILURE_REASONS = new Set<string>([
  'unknown',
  'official-source-not-captured',
  'solution-fragment-not-archived',
]);

function isOfficialSourceGateFailure(entry: ProblemCoverageGapEntry): boolean {
  return !entry.blockedReason || OFFICIAL_SOURCE_GATE_FAILURE_REASONS.has(entry.blockedReason);
}

export function buildProblemCoverageGapReport(options: {
  normalizedRoot: string;
  snapshotId: string;
  coverageIndex: ProblemCoverageIndex;
  now?: Date;
}): ProblemCoverageGapReport {
  const coverageRoot = join(options.normalizedRoot, 'problem-coverage');
  mkdirSync(coverageRoot, { recursive: true });

  const records = [...options.coverageIndex.records].sort((left, right) =>
    left.problemId - right.problemId,
  );
  const unsolvedProblemIds = records
    .filter((record) => !record.solvedByMe)
    .map((record) => record.problemId);

  const missingOfficialSources = records
    .filter((record) => !record.officialSourceArchived)
    .map((record) =>
      toGapEntry(
        record,
        (record.officialSourceBlockedReason as OfficialSourceBlockedReason | undefined)
          ?? deriveOfficialBlockedReason(record),
      )
    )
    .sort((left, right) => left.problemId - right.problemId);
  const solvedByMeMissingUserSource = records
    .filter(isSolvedByMeMissingUserSource)
    .map((record) => toGapEntry(record))
    .sort((left, right) => left.problemId - right.problemId);
  const noTestsProblemIds = records
    .filter((record) => !hasGapTestsAvailable(record))
    .map((record) => record.problemId);
  const exampleOnlyProblemIds = records
    .filter(isExampleOnly)
    .map((record) => record.problemId);
  const visibleTestsPresentProblemIds = records
    .filter((record) => record.visibleTestsCapturedCount > 0)
    .map((record) => record.problemId);
  const newSinceBaselineProblemIds = records
    .filter((record) => record.newSinceBaseline)
    .map((record) => record.problemId);

  const officialSourceGateFailures = missingOfficialSources
    .filter(isOfficialSourceGateFailure)
    .map((entry) => entry.problemId);
  const solvedUserSourceFailures = solvedByMeMissingUserSource.map(
    (entry) => entry.problemId,
  );

  const reportPath = writeJsonRecord(coverageRoot, 'gaps.json', {
    snapshotId: options.snapshotId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    paths: {
      reportPath: join(coverageRoot, 'gaps.json'),
      unsolvedPath: join(coverageRoot, 'unsolved-problems.json'),
      missingOfficialPath: join(coverageRoot, 'missing-official-sources.json'),
      missingSolvedUserSourcePath: join(
        coverageRoot,
        'missing-user-sources-solved.json',
      ),
      noTestsPath: join(coverageRoot, 'no-tests-problems.json'),
      exampleOnlyPath: join(coverageRoot, 'example-only-problems.json'),
      visibleTestsPath: join(coverageRoot, 'visible-tests-problems.json'),
      newSinceBaselinePath: join(coverageRoot, 'new-since-baseline-problems.json'),
    },
    totals: {
      totalProblems: records.length,
      solvedByMeCount: records.filter((record) => record.solvedByMe).length,
      unsolvedCount: unsolvedProblemIds.length,
      missingOfficialSourceCount: missingOfficialSources.length,
      solvedByMeMissingUserSourceCount: solvedByMeMissingUserSource.length,
      noTestsCount: noTestsProblemIds.length,
      exampleOnlyCount: exampleOnlyProblemIds.length,
      visibleTestsPresentCount: visibleTestsPresentProblemIds.length,
      newSinceBaselineCount: newSinceBaselineProblemIds.length,
    },
    gates: {
      officialSourceGate: {
        passed: officialSourceGateFailures.length === 0,
        failedProblemIds: officialSourceGateFailures,
        failureCount: officialSourceGateFailures.length,
      },
      solvedUserSourceGate: {
        passed: solvedUserSourceFailures.length === 0,
        failedProblemIds: solvedUserSourceFailures,
        failureCount: solvedUserSourceFailures.length,
      },
    },
    unsolvedProblemIds,
    missingOfficialSources,
    solvedByMeMissingUserSource: solvedByMeMissingUserSource,
    noTestsProblemIds,
    exampleOnlyProblemIds,
    visibleTestsPresentProblemIds,
    newSinceBaselineProblemIds,
  } satisfies ProblemCoverageGapReport);

  const unsolvedPath = writeJsonRecord(
    coverageRoot,
    'unsolved-problems.json',
    {
      snapshotId: options.snapshotId,
      generatedAt: (options.now ?? new Date()).toISOString(),
      problemIds: unsolvedProblemIds,
    },
  );
  const missingOfficialPath = writeJsonRecord(
    coverageRoot,
    'missing-official-sources.json',
    {
      snapshotId: options.snapshotId,
      generatedAt: (options.now ?? new Date()).toISOString(),
      records: missingOfficialSources,
    },
  );
  const missingSolvedUserSourcePath = writeJsonRecord(
    coverageRoot,
    'missing-user-sources-solved.json',
    {
      snapshotId: options.snapshotId,
      generatedAt: (options.now ?? new Date()).toISOString(),
      records: solvedByMeMissingUserSource,
    },
  );
  const noTestsPath = writeJsonRecord(coverageRoot, 'no-tests-problems.json', {
    snapshotId: options.snapshotId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    problemIds: noTestsProblemIds,
  });
  const exampleOnlyPath = writeJsonRecord(coverageRoot, 'example-only-problems.json', {
    snapshotId: options.snapshotId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    problemIds: exampleOnlyProblemIds,
  });
  const visibleTestsPath = writeJsonRecord(coverageRoot, 'visible-tests-problems.json', {
    snapshotId: options.snapshotId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    problemIds: visibleTestsPresentProblemIds,
  });
  const newSinceBaselinePath = writeJsonRecord(
    coverageRoot,
    'new-since-baseline-problems.json',
    {
      snapshotId: options.snapshotId,
      generatedAt: (options.now ?? new Date()).toISOString(),
      problemIds: newSinceBaselineProblemIds,
    },
  );

  return {
    snapshotId: options.snapshotId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    paths: {
      reportPath,
      unsolvedPath,
      missingOfficialPath,
      missingSolvedUserSourcePath,
      noTestsPath,
      exampleOnlyPath,
      visibleTestsPath,
      newSinceBaselinePath,
    },
    totals: {
      totalProblems: records.length,
      solvedByMeCount: records.filter((record) => record.solvedByMe).length,
      unsolvedCount: unsolvedProblemIds.length,
      missingOfficialSourceCount: missingOfficialSources.length,
      solvedByMeMissingUserSourceCount: solvedByMeMissingUserSource.length,
      noTestsCount: noTestsProblemIds.length,
      exampleOnlyCount: exampleOnlyProblemIds.length,
      visibleTestsPresentCount: visibleTestsPresentProblemIds.length,
      newSinceBaselineCount: newSinceBaselineProblemIds.length,
    },
    gates: {
      officialSourceGate: {
        passed: officialSourceGateFailures.length === 0,
        failedProblemIds: officialSourceGateFailures,
        failureCount: officialSourceGateFailures.length,
      },
      solvedUserSourceGate: {
        passed: solvedUserSourceFailures.length === 0,
        failedProblemIds: solvedUserSourceFailures,
        failureCount: solvedUserSourceFailures.length,
      },
    },
    unsolvedProblemIds,
    missingOfficialSources,
    solvedByMeMissingUserSource,
    noTestsProblemIds,
    exampleOnlyProblemIds,
    visibleTestsPresentProblemIds,
    newSinceBaselineProblemIds,
  };
}

export function readProblemCoverageGapReport(
  normalizedRoot: string,
): ProblemCoverageGapReport | undefined {
  const reportPath = join(normalizedRoot, 'problem-coverage', 'gaps.json');
  if (!existsSync(reportPath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(reportPath, 'utf8')) as ProblemCoverageGapReport;
  } catch {
    return undefined;
  }
}

function toGapEntry(
  record: ProblemCoverageRecord,
  blockedReason?: OfficialSourceBlockedReason,
): ProblemCoverageGapEntry {
  return {
    problemId: record.problemId,
    slug: record.slug,
    name: record.name,
    mirrorRoute: record.mirrorRoute,
    solvedByMe: record.solvedByMe,
    officialSourceArchived: record.officialSourceArchived,
    userSourceArchived: record.userSourceArchived,
    missingTrustworthyUserSourceLanguages: record.missingTrustworthyUserSourceLanguages,
    blockedReason,
    evidence: buildGapEvidence(record),
  };
}

function orElse<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

function buildGapEvidence(
  record: ProblemCoverageRecord,
): ProblemCoverageGapEntry['evidence'] {
  return {
    sourceListUrl: record.sourceListUrl,
    editorialAvailability: record.editorialAvailability,
    statementArchived: record.statementArchived,
    solutionFragmentArchived: record.solutionFragmentArchived,
    testsFragmentArchived: record.testsFragmentArchived,
    officialSolutionPresent: record.officialSolutionPresent,
    effectiveTestsAvailableCount: record.effectiveTestsAvailableCount,
    testsCoverageStatus: orElse(record.testsCoverageStatus, 'not-captured-yet'),
    officialSourceStatus: orElse(record.officialSourceStatus, 'not-captured-yet'),
    officialSourceLanguages: orElse(record.officialSourceLanguages, []),
    userSourceLanguages: orElse(record.userSourceLanguages, []),
    requiredTrustworthyUserSourceLanguages: orElse(
      record.requiredTrustworthyUserSourceLanguages,
      [],
    ),
    trustworthyUserSourceLanguages: orElse(record.trustworthyUserSourceLanguages, []),
    bestTrustworthyUserPerLanguage: orElse(record.bestTrustworthyUserPerLanguage, {}),
    archiveCompletenessStatus: orElse(record.archiveCompletenessStatus, 'incomplete'),
    notes: record.notes,
  };
}

function deriveOfficialBlockedReason(
  record: ProblemCoverageRecord,
): OfficialSourceBlockedReason {
  if (record.officialSourceArchived) {
    return 'official-source-not-captured';
  }
  if (record.editorialAvailability === 'hidden') {
    return 'editorial-hidden';
  }
  if (record.editorialAvailability === 'restricted') {
    return 'editorial-restricted';
  }
  if (record.officialSourceStatus === 'not-available-upstream') {
    return 'not-available-upstream';
  }
  if (!record.solutionFragmentArchived) {
    return 'solution-fragment-not-archived';
  }
  if (record.solutionFragmentArchived || record.officialSolutionPresent) {
    return 'official-source-not-captured';
  }
  return 'unknown';
}
