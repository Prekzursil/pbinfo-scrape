import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  readProblemCoverageGapReport,
} from '../../coverage/coverage-gaps.js';
import {
  readProblemCoverageIndex,
  readProblemCoverageRecord,
} from '../../coverage/problem-coverage.js';
import { resolveReadableSnapshotLayout } from '../../archive/storage.js';
import { loadLocalConfig } from '../../config/local-config.js';
import type {
  ProblemCoverageIndex,
  ProblemCoverageRecord,
} from '../../types/records.js';
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
  GuiCoverageProgressFilter,
  GuiCoverageSortKey,
  GuiCoverageSortDir,
} from '../shared/types.js';

const DEFAULT_LIST_LIMIT = 100;

export interface ExploreCoverageOptions {
  snapshotId?: string;
}

export interface ListCoverageOptions extends ExploreCoverageOptions {
  query?: string;
  offset?: number;
  limit?: number;
  solved?: GuiCoverageSolvedFilter;
  testsFragmentArchived?: GuiCoveragePresenceFilter;
  visibleTestsCaptured?: GuiCoveragePresenceFilter;
  testsCoverageStatus?: GuiCoverageTestsStatusFilter;
  officialSourceArchived?: GuiCoveragePresenceFilter;
  userSourceArchived?: GuiCoveragePresenceFilter;
  editorialAvailability?: GuiCoverageEditorialFilter;
  archiveCompletenessStatus?: GuiCoverageArchiveStateFilter;
  grade?: number;
  progressState?: GuiCoverageProgressFilter;
  languagesTried?: string[];
  bestScoreMin?: number;
  bestScoreMax?: number;
  sortBy?: GuiCoverageSortKey;
  sortDir?: GuiCoverageSortDir;
}

export interface ReadCoverageOptions extends ExploreCoverageOptions {
  problemId: number;
}

export function getCoverageExplorerSummary(
  workspaceRoot: string,
  options: ExploreCoverageOptions = {},
): GuiCoverageSummary {
  const context = resolveCoverageContext(workspaceRoot, options.snapshotId);
  const gapReport = readProblemCoverageGapReport(context.layout.normalizedRoot);
  const derivedStatusCounts = context.index.records.reduce(
    (accumulator, record) => {
      const officialSourceStatus =
        record.officialSourceStatus ?? deriveOfficialSourceStatus(record);
      const testsCoverageStatus =
        record.testsCoverageStatus ?? deriveTestsCoverageStatus(record);
      const archiveCompletenessStatus =
        record.archiveCompletenessStatus ?? deriveArchiveCompletenessStatus(record);

      if (archiveCompletenessStatus === 'complete') {
        accumulator.completeProblemCount += 1;
      }
      if (record.solvedByMe && archiveCompletenessStatus !== 'complete') {
        accumulator.incompleteSolvedProblemCount += 1;
      }
      if (archiveCompletenessStatus === 'missing-official-source') {
        accumulator.missingOfficialSourceCaptureCount += 1;
      }
      if (officialSourceStatus === 'not-available-upstream') {
        accumulator.officialSourceUnavailableUpstreamCount += 1;
      }
      if (testsCoverageStatus === 'not-captured-yet') {
        accumulator.missingTestsCaptureCount += 1;
      }
      if (testsCoverageStatus === 'not-available-upstream') {
        accumulator.testsUnavailableUpstreamCount += 1;
      }

      return accumulator;
    },
    {
      completeProblemCount: 0,
      incompleteSolvedProblemCount: 0,
      missingOfficialSourceCaptureCount: 0,
      officialSourceUnavailableUpstreamCount: 0,
      missingTestsCaptureCount: 0,
      testsUnavailableUpstreamCount: 0,
    },
  );
  const unsolvedProblemIds =
    gapReport?.unsolvedProblemIds
    ?? context.index.records.filter((record) => !record.solvedByMe).map((record) => record.problemId);
  const missingOfficialSourceProblemIds =
    gapReport?.missingOfficialSources.map((entry) => entry.problemId)
    ?? context.index.records
      .filter((record) => !record.officialSourceArchived)
      .map((record) => record.problemId);
  const solvedByMeMissingUserSourceProblemIds =
    gapReport?.solvedByMeMissingUserSource.map((entry) => entry.problemId)
    ?? context.index.records
      .filter((record) => (record.missingTrustworthyUserSourceLanguages?.length ?? 0) > 0)
      .map((record) => record.problemId);

  return {
    snapshotId: context.layout.snapshotId,
    coverageRoot: context.coverageRoot,
    normalizedRoot: context.layout.normalizedRoot,
    mirrorRoot: context.layout.mirrorRoot,
    mirrorServeCommand: `npm run cli -- serve --snapshot ${context.layout.snapshotId} --port 4173`,
    mirrorUrl: 'http://127.0.0.1:4173/',
    unsolvedProblemCount: unsolvedProblemIds.length,
    missingOfficialSourceCount: missingOfficialSourceProblemIds.length,
    solvedByMeMissingUserSourceCount: solvedByMeMissingUserSourceProblemIds.length,
    unsolvedProblemIds,
    missingOfficialSourceProblemIds,
    solvedByMeMissingUserSourceProblemIds,
    ...derivedStatusCounts,
    ...context.index.totals,
  };
}

export function listCoverageExplorerRecords(
  workspaceRoot: string,
  options: ListCoverageOptions,
): GuiCoverageListing {
  const context = resolveCoverageContext(workspaceRoot, options.snapshotId);
  const query = normalizeQuery(options.query);
  const limit = options.limit ?? DEFAULT_LIST_LIMIT;
  const offset = options.offset ?? 0;
  const sortBy: GuiCoverageSortKey = options.sortBy ?? 'problem-id';
  const sortDir: GuiCoverageSortDir = options.sortDir ?? 'asc';
  const filtered = context.index.records
    .filter((record) => matchesCoverageFilters(record, options, query))
    .sort((left, right) => compareCoverageRecords(left, right, sortBy, sortDir))
    .map(toGuiCoverageRecord);

  return {
    snapshotId: context.layout.snapshotId,
    totalCount: filtered.length,
    offset,
    limit,
    items: filtered.slice(offset, offset + limit),
  };
}

export function readCoverageExplorerRecord(
  workspaceRoot: string,
  options: ReadCoverageOptions,
): GuiCoverageDetail {
  const context = resolveCoverageContext(workspaceRoot, options.snapshotId);
  const record =
    readProblemCoverageRecord(context.layout.normalizedRoot, options.problemId)
    ?? context.index.records.find((entry) => entry.problemId === options.problemId);
  if (!record) {
    throw new Error(`Coverage record "${options.problemId}" was not found.`);
  }

  const coverageFilePath = join(
    context.coverageRoot,
    `problem-${record.problemId}.json`,
  );
  const rankingFilePath = join(
    context.layout.normalizedRoot,
    'rankings',
    'problems',
    `problem-${record.problemId}.json`,
  );

  return {
    snapshotId: context.layout.snapshotId,
    record: {
      ...toGuiCoverageRecord(record),
      canonicalUrl: record.canonicalUrl,
      sourceListUrl: record.sourceListUrl,
      statementArchived: record.statementArchived,
      solutionFragmentArchived: record.solutionFragmentArchived,
      officialSourceCount: record.officialSourceCount,
      userSourceCount: record.userSourceCount,
      hasAnyArchivedSource: record.hasAnyArchivedSource,
      bestUserOverallEvaluationId: record.bestUserOverallEvaluationId,
      evaluationIds: record.evaluationIds,
    },
    coverageFilePath,
    rawRecordLinks: {
      coverageFilePath,
      problemFilePath: join(
        context.layout.normalizedRoot,
        'problems',
        `problem-${record.problemId}.json`,
      ),
      rankingFilePath: record.rankingPresent && existsSync(rankingFilePath)
        ? rankingFilePath
        : undefined,
      evaluationFilePaths: record.evaluationIds.map((evaluationId) =>
        join(
          context.layout.normalizedRoot,
          'evaluations',
          `evaluation-${evaluationId}.json`,
        )),
      officialSourceFilePaths: (record.officialSourceIds ?? []).map((sourceId) =>
        join(context.layout.normalizedRoot, 'sources', `${sourceId}.json`)),
      userSourceFilePaths: (record.userSourceIds ?? []).map((sourceId) =>
        join(context.layout.normalizedRoot, 'sources', `${sourceId}.json`)),
    },
  };
}

interface CoverageContext {
  layout: ReturnType<typeof resolveReadableSnapshotLayout>;
  coverageRoot: string;
  index: ProblemCoverageIndex;
}

function resolveCoverageContext(
  workspaceRoot: string,
  snapshotId?: string,
): CoverageContext {
  const config = loadLocalConfig(workspaceRoot);
  const layout = resolveReadableSnapshotLayout(config, snapshotId);
  const index = readProblemCoverageIndex(layout.normalizedRoot);
  if (!index) {
    throw new Error(
      `Problem coverage has not been generated for snapshot ${layout.snapshotId} yet.`,
    );
  }

  return {
    layout,
    coverageRoot: join(layout.normalizedRoot, 'problem-coverage'),
    index,
  };
}

function toGuiCoverageRecord(record: ProblemCoverageRecord): GuiCoverageRecord {
  return {
    problemId: record.problemId,
    slug: record.slug,
    name: record.name,
    grade: record.grade,
    mirrorRoute: record.mirrorRoute,
    tags: record.tags,
    solvedByMe: record.solvedByMe,
    evaluationCount: record.evaluationCount,
    solvedEvaluationCount: record.solvedEvaluationCount,
    rankingPresent: record.rankingPresent,
    testsFragmentArchived: record.testsFragmentArchived,
    exampleTestsAvailableCount: record.exampleTestsAvailableCount,
    visibleTestsCapturedCount: record.visibleTestsCapturedCount,
    evaluationObservedTestsCount: record.evaluationObservedTestsCount,
    effectiveTestsAvailableCount:
      record.effectiveTestsAvailableCount
      ?? record.visibleTestsCapturedCount
      ?? record.exampleTestsAvailableCount
      ?? 0,
    testsCoverageStatus: record.testsCoverageStatus ?? deriveTestsCoverageStatus(record),
    officialSolutionPresent: record.officialSolutionPresent,
    officialSourceArchived: record.officialSourceArchived,
    officialSourceLanguages: record.officialSourceLanguages ?? [],
    officialSourceStatus:
      record.officialSourceStatus
      ?? deriveOfficialSourceStatus(record),
    userSourceArchived: record.userSourceArchived,
    userSourceLanguages: record.userSourceLanguages ?? [],
    requiredTrustworthyUserSourceLanguages:
      record.requiredTrustworthyUserSourceLanguages
      ?? deriveRequiredTrustworthyLanguages(record),
    trustworthyUserSourceLanguages: record.trustworthyUserSourceLanguages ?? [],
    bestTrustworthyUserPerLanguage:
      record.bestTrustworthyUserPerLanguage ?? {},
    missingTrustworthyUserSourceLanguages:
      record.missingTrustworthyUserSourceLanguages ?? [],
    archiveCompletenessStatus:
      record.archiveCompletenessStatus
      ?? deriveArchiveCompletenessStatus(record),
    editorialAvailability: record.editorialAvailability,
    testsAvailable:
      record.testsAvailable
      ?? record.testsFragmentArchived
      ?? ((record.exampleTestsAvailableCount ?? 0) > 0),
    unsolvedByConfiguredHandle:
      record.unsolvedByConfiguredHandle
      ?? !record.solvedByMe,
    officialSourceBlocked: record.officialSourceBlocked ?? false,
    officialSourceBlockedReason: record.officialSourceBlockedReason,
    notArchivedYet: record.notArchivedYet ?? false,
    newSinceBaseline: record.newSinceBaseline ?? false,
    notes: record.notes,
    progressState: record.progressState,
    bestScore: record.bestScore,
    lastAttemptAt: record.lastAttemptAt,
    evaluationTimeline: record.evaluationTimeline,
    languagesTried: record.languagesTried,
    requiredTestsCaptured: record.requiredTestsCaptured,
  };
}

function compareCoverageRecords(
  left: ProblemCoverageRecord,
  right: ProblemCoverageRecord,
  sortBy: GuiCoverageSortKey,
  sortDir: GuiCoverageSortDir,
): number {
  const direction = sortDir === 'desc' ? -1 : 1;
  switch (sortBy) {
    case 'problem-id':
      return (left.problemId - right.problemId) * direction;
    case 'grade': {
      const gradeDiff = (left.grade ?? 0) - (right.grade ?? 0);
      if (gradeDiff !== 0) {
        return gradeDiff * direction;
      }
      return left.problemId - right.problemId;
    }
    case 'best-score':
      return ((left.bestScore ?? 0) - (right.bestScore ?? 0)) * direction;
    case 'last-attempt': {
      const leftTs = left.lastAttemptAt ?? '';
      const rightTs = right.lastAttemptAt ?? '';
      return leftTs.localeCompare(rightTs) * direction;
    }
    case 'name':
      return left.name.localeCompare(right.name) * direction;
    case 'attempts':
      return ((left.evaluationCount ?? 0) - (right.evaluationCount ?? 0)) * direction;
    case 'completeness': {
      const leftScore = completenessScore(left);
      const rightScore = completenessScore(right);
      return (leftScore - rightScore) * direction;
    }
    default:
      return (left.problemId - right.problemId) * direction;
  }
}

function completenessScore(record: ProblemCoverageRecord): number {
  // Lower is "more complete". Count missing pillars for stable ordering.
  let missing = 0;
  if (!record.statementArchived) missing += 1;
  if (record.solvedByMe && !record.userSourceArchived) missing += 1;
  if (!record.officialSourceArchived) missing += 1;
  if (record.testsCoverageStatus === 'not-captured-yet') missing += 1;
  if (record.editorialAvailability === 'unknown') missing += 1;
  return missing;
}

function matchesCoverageFilters(
  record: ProblemCoverageRecord,
  options: ListCoverageOptions,
  query: string | undefined,
): boolean {
  if (options.solved === 'solved' && !record.solvedByMe) {
    return false;
  }
  if (options.solved === 'unsolved' && record.solvedByMe) {
    return false;
  }
  if (!matchesPresenceFilter(record.testsFragmentArchived, options.testsFragmentArchived)) {
    return false;
  }
  if (
    !matchesPresenceFilter(
      record.visibleTestsCapturedCount > 0,
      options.visibleTestsCaptured,
    )
  ) {
    return false;
  }
  if (
    options.testsCoverageStatus
    && options.testsCoverageStatus !== 'all'
    && (record.testsCoverageStatus ?? deriveTestsCoverageStatus(record)) !== options.testsCoverageStatus
  ) {
    return false;
  }
  if (
    !matchesPresenceFilter(
      record.officialSourceArchived,
      options.officialSourceArchived,
    )
  ) {
    return false;
  }
  if (!matchesPresenceFilter(record.userSourceArchived, options.userSourceArchived)) {
    return false;
  }
  if (
    options.editorialAvailability
    && options.editorialAvailability !== 'all'
    && record.editorialAvailability !== options.editorialAvailability
  ) {
    return false;
  }
  if (typeof options.grade === 'number' && record.grade !== options.grade) {
    return false;
  }
  if (
    options.archiveCompletenessStatus
    && options.archiveCompletenessStatus !== 'all'
    && (record.archiveCompletenessStatus ?? deriveArchiveCompletenessStatus(record))
      !== options.archiveCompletenessStatus
  ) {
    return false;
  }
  if (!query) {
    return true;
  }

  const haystack = [
    String(record.problemId),
    record.name,
    record.slug,
    record.tags.join(' '),
    record.mirrorRoute,
    ...record.notes,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function deriveTestsCoverageStatus(
  record: Pick<
    ProblemCoverageRecord,
    | 'testsFragmentArchived'
    | 'exampleTestsAvailableCount'
    | 'visibleTestsCapturedCount'
    | 'evaluationObservedTestsCount'
    | 'effectiveTestsAvailableCount'
  >,
): GuiCoverageRecord['testsCoverageStatus'] {
  if (
    (record.effectiveTestsAvailableCount ?? 0) > 0
    || (record.exampleTestsAvailableCount ?? 0) > 0
    || (record.visibleTestsCapturedCount ?? 0) > 0
    || (record.evaluationObservedTestsCount ?? 0) > 0
  ) {
    return 'captured';
  }
  if (record.testsFragmentArchived) {
    return 'not-available-upstream';
  }
  return 'not-captured-yet';
}

function deriveOfficialSourceStatus(
  record: Pick<
    ProblemCoverageRecord,
    'officialSourceArchived' | 'editorialAvailability' | 'sourceListUrl'
  >,
): GuiCoverageRecord['officialSourceStatus'] {
  if (record.officialSourceArchived) {
    return 'archived';
  }
  if (record.editorialAvailability === 'hidden' || record.editorialAvailability === 'restricted') {
    return 'restricted-upstream';
  }
  if (!record.sourceListUrl) {
    return 'not-available-upstream';
  }
  return 'not-captured-yet';
}

function deriveRequiredTrustworthyLanguages(
  record: Pick<
    ProblemCoverageRecord,
    'missingTrustworthyUserSourceLanguages' | 'trustworthyUserSourceLanguages'
  >,
): string[] {
  return [...new Set([
    ...(record.trustworthyUserSourceLanguages ?? []),
    ...(record.missingTrustworthyUserSourceLanguages ?? []),
  ])].sort();
}

function deriveArchiveCompletenessStatus(
  record: Pick<
    ProblemCoverageRecord,
    | 'notArchivedYet'
    | 'solvedByMe'
    | 'missingTrustworthyUserSourceLanguages'
    | 'userSourceArchived'
    | 'testsFragmentArchived'
    | 'exampleTestsAvailableCount'
    | 'visibleTestsCapturedCount'
    | 'evaluationObservedTestsCount'
    | 'effectiveTestsAvailableCount'
    | 'officialSourceArchived'
    | 'editorialAvailability'
    | 'sourceListUrl'
  >,
): GuiCoverageRecord['archiveCompletenessStatus'] {
  if (record.notArchivedYet) {
    return 'not-archived-yet';
  }
  if (!record.solvedByMe) {
    return 'unsolved';
  }
  if (
    (record.missingTrustworthyUserSourceLanguages?.length ?? 0) > 0
    || !record.userSourceArchived
  ) {
    return 'missing-user-source';
  }
  if (deriveOfficialSourceStatus(record) === 'not-captured-yet') {
    return 'missing-official-source';
  }
  if (deriveTestsCoverageStatus(record) === 'not-captured-yet') {
    return 'incomplete';
  }
  return 'complete';
}

function matchesPresenceFilter(
  value: boolean,
  filter: GuiCoveragePresenceFilter | undefined,
): boolean {
  if (!filter || filter === 'all') {
    return true;
  }
  return filter === 'yes' ? value : !value;
}

function normalizeQuery(query: string | undefined): string | undefined {
  const trimmed = query?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}
