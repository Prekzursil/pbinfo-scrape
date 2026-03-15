import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeJsonRecord } from '../archive/json-store.js';
import type {
  ProblemCoverageIndex,
  ProblemCoverageRecord,
} from '../types/records.js';

export type OfficialSourceBlockedReason =
  | 'no-source-list-url'
  | 'editorial-hidden'
  | 'editorial-restricted'
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
  blockedReason?: OfficialSourceBlockedReason;
  evidence: {
    sourceListUrl?: string;
    editorialAvailability: ProblemCoverageRecord['editorialAvailability'];
    statementArchived: boolean;
    solutionFragmentArchived: boolean;
    testsFragmentArchived: boolean;
    officialSolutionPresent: boolean;
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
  };
  totals: {
    totalProblems: number;
    solvedByMeCount: number;
    unsolvedCount: number;
    missingOfficialSourceCount: number;
    solvedByMeMissingUserSourceCount: number;
  };
  gates: {
    officialSourceGate: CoverageHardGateStatus;
    solvedUserSourceGate: CoverageHardGateStatus;
  };
  unsolvedProblemIds: number[];
  missingOfficialSources: ProblemCoverageGapEntry[];
  solvedByMeMissingUserSource: ProblemCoverageGapEntry[];
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
    .map((record) => toGapEntry(record, deriveOfficialBlockedReason(record)))
    .sort((left, right) => left.problemId - right.problemId);
  const solvedByMeMissingUserSource = records
    .filter((record) => record.solvedByMe && !record.userSourceArchived)
    .map((record) => toGapEntry(record))
    .sort((left, right) => left.problemId - right.problemId);

  const officialSourceGateFailures = missingOfficialSources
    .filter((entry) => !entry.blockedReason || entry.blockedReason === 'unknown')
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
    },
    totals: {
      totalProblems: records.length,
      solvedByMeCount: records.filter((record) => record.solvedByMe).length,
      unsolvedCount: unsolvedProblemIds.length,
      missingOfficialSourceCount: missingOfficialSources.length,
      solvedByMeMissingUserSourceCount: solvedByMeMissingUserSource.length,
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

  return {
    snapshotId: options.snapshotId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    paths: {
      reportPath,
      unsolvedPath,
      missingOfficialPath,
      missingSolvedUserSourcePath,
    },
    totals: {
      totalProblems: records.length,
      solvedByMeCount: records.filter((record) => record.solvedByMe).length,
      unsolvedCount: unsolvedProblemIds.length,
      missingOfficialSourceCount: missingOfficialSources.length,
      solvedByMeMissingUserSourceCount: solvedByMeMissingUserSource.length,
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
    blockedReason,
    evidence: {
      sourceListUrl: record.sourceListUrl,
      editorialAvailability: record.editorialAvailability,
      statementArchived: record.statementArchived,
      solutionFragmentArchived: record.solutionFragmentArchived,
      testsFragmentArchived: record.testsFragmentArchived,
      officialSolutionPresent: record.officialSolutionPresent,
      notes: record.notes,
    },
  };
}

function deriveOfficialBlockedReason(
  record: ProblemCoverageRecord,
): OfficialSourceBlockedReason {
  if (record.officialSourceArchived) {
    return 'official-source-not-captured';
  }
  if (!record.sourceListUrl) {
    return 'no-source-list-url';
  }
  if (record.editorialAvailability === 'hidden') {
    return 'editorial-hidden';
  }
  if (record.editorialAvailability === 'restricted') {
    return 'editorial-restricted';
  }
  if (!record.solutionFragmentArchived) {
    return 'solution-fragment-not-archived';
  }
  if (record.solutionFragmentArchived || record.officialSolutionPresent) {
    return 'official-source-not-captured';
  }
  return 'unknown';
}
