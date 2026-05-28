import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readProblemCoverageGapReport } from '../../coverage/coverage-gaps.js';
import {
  readProblemCoverageIndex,
  readProblemCoverageRecord,
} from '../../coverage/problem-coverage.js';
import { resolveReadableSnapshotLayout } from '../../archive/storage.js';
import { loadLocalConfig } from '../../config/local-config.js';
import type { ProblemCoverageIndex, ProblemCoverageRecord } from '../../types/records.js';
import type {
  GuiCoverageDetail,
  GuiCoverageListing,
  GuiCoveragePresenceFilter,
  GuiCoverageQuery,
  GuiCoverageRecord,
  GuiCoverageSummary,
} from '../shared/types.js';

const DEFAULT_LIST_LIMIT = 100;

export interface ExploreCoverageOptions {
  snapshotId?: string;
}

export type ListCoverageOptions = GuiCoverageQuery;

export interface ReadCoverageOptions extends ExploreCoverageOptions {
  problemId: number;
}

interface DerivedStatusCounts {
  completeProblemCount: number;
  incompleteSolvedProblemCount: number;
  missingOfficialSourceCaptureCount: number;
  officialSourceUnavailableUpstreamCount: number;
  missingTestsCaptureCount: number;
  testsUnavailableUpstreamCount: number;
}

const STATUS_COUNT_RULES: ReadonlyArray<{
  key: keyof DerivedStatusCounts;
  applies: (input: {
    record: ProblemCoverageRecord;
    officialSourceStatus: string;
    testsCoverageStatus: string;
    archiveCompletenessStatus: string;
  }) => boolean;
}> = [
  { key: 'completeProblemCount', applies: (i) => i.archiveCompletenessStatus === 'complete' },
  {
    key: 'incompleteSolvedProblemCount',
    applies: (i) => i.record.solvedByMe && i.archiveCompletenessStatus !== 'complete',
  },
  {
    key: 'missingOfficialSourceCaptureCount',
    applies: (i) => i.archiveCompletenessStatus === 'missing-official-source',
  },
  {
    key: 'officialSourceUnavailableUpstreamCount',
    applies: (i) => i.officialSourceStatus === 'not-available-upstream',
  },
  {
    key: 'missingTestsCaptureCount',
    applies: (i) => i.testsCoverageStatus === 'not-captured-yet',
  },
  {
    key: 'testsUnavailableUpstreamCount',
    applies: (i) => i.testsCoverageStatus === 'not-available-upstream',
  },
];

function accumulateStatusCounts(
  accumulator: DerivedStatusCounts,
  record: ProblemCoverageRecord,
): DerivedStatusCounts {
  const input = {
    record,
    officialSourceStatus: record.officialSourceStatus ?? deriveOfficialSourceStatus(record),
    testsCoverageStatus: record.testsCoverageStatus ?? deriveTestsCoverageStatus(record),
    archiveCompletenessStatus:
      record.archiveCompletenessStatus ?? deriveArchiveCompletenessStatus(record),
  };

  for (const rule of STATUS_COUNT_RULES) {
    if (rule.applies(input)) {
      accumulator[rule.key] += 1;
    }
  }

  return accumulator;
}

export function getCoverageExplorerSummary(
  workspaceRoot: string,
  options: ExploreCoverageOptions = {},
): GuiCoverageSummary {
  const context = resolveCoverageContext(workspaceRoot, options.snapshotId);
  const gapReport = readProblemCoverageGapReport(context.layout.normalizedRoot);
  const derivedStatusCounts = context.index.records.reduce(accumulateStatusCounts, {
    completeProblemCount: 0,
    incompleteSolvedProblemCount: 0,
    missingOfficialSourceCaptureCount: 0,
    officialSourceUnavailableUpstreamCount: 0,
    missingTestsCaptureCount: 0,
    testsUnavailableUpstreamCount: 0,
  });
  const unsolvedProblemIds =
    gapReport?.unsolvedProblemIds ??
    context.index.records.filter((record) => !record.solvedByMe).map((record) => record.problemId);
  const missingOfficialSourceProblemIds =
    gapReport?.missingOfficialSources.map((entry) => entry.problemId) ??
    context.index.records
      .filter((record) => !record.officialSourceArchived)
      .map((record) => record.problemId);
  const solvedByMeMissingUserSourceProblemIds =
    gapReport?.solvedByMeMissingUserSource.map((entry) => entry.problemId) ??
    context.index.records
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
  const filtered = context.index.records
    .filter((record) => matchesCoverageFilters(record, options, query))
    .sort((left, right) => left.problemId - right.problemId)
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
    readProblemCoverageRecord(context.layout.normalizedRoot, options.problemId) ??
    context.index.records.find((entry) => entry.problemId === options.problemId);
  if (!record) {
    throw new Error(`Coverage record "${options.problemId}" was not found.`);
  }

  const coverageFilePath = join(context.coverageRoot, `problem-${record.problemId}.json`);
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
      rankingFilePath:
        record.rankingPresent && existsSync(rankingFilePath) ? rankingFilePath : undefined,
      evaluationFilePaths: record.evaluationIds.map((evaluationId) =>
        join(context.layout.normalizedRoot, 'evaluations', `evaluation-${evaluationId}.json`),
      ),
      officialSourceFilePaths: (record.officialSourceIds ?? []).map((sourceId) =>
        join(context.layout.normalizedRoot, 'sources', `${sourceId}.json`),
      ),
      userSourceFilePaths: (record.userSourceIds ?? []).map((sourceId) =>
        join(context.layout.normalizedRoot, 'sources', `${sourceId}.json`),
      ),
    },
  };
}

interface CoverageContext {
  layout: ReturnType<typeof resolveReadableSnapshotLayout>;
  coverageRoot: string;
  index: ProblemCoverageIndex;
}

function resolveCoverageContext(workspaceRoot: string, snapshotId?: string): CoverageContext {
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

function toGuiTestsFields(
  record: ProblemCoverageRecord,
): Pick<
  GuiCoverageRecord,
  | 'testsFragmentArchived'
  | 'exampleTestsAvailableCount'
  | 'visibleTestsCapturedCount'
  | 'evaluationObservedTestsCount'
  | 'effectiveTestsAvailableCount'
  | 'testsCoverageStatus'
  | 'testsAvailable'
> {
  return {
    testsFragmentArchived: record.testsFragmentArchived,
    exampleTestsAvailableCount: record.exampleTestsAvailableCount,
    visibleTestsCapturedCount: record.visibleTestsCapturedCount,
    evaluationObservedTestsCount: record.evaluationObservedTestsCount,
    effectiveTestsAvailableCount: resolveEffectiveTestsCount(record),
    testsCoverageStatus: withFallback(record.testsCoverageStatus, () =>
      deriveTestsCoverageStatus(record),
    ),
    testsAvailable: resolveTestsAvailable(record),
  };
}

function withFallback<T>(value: T | undefined, fallback: () => T): T {
  return value ?? fallback();
}

function resolveEffectiveTestsCount(record: ProblemCoverageRecord): number {
  return (
    record.effectiveTestsAvailableCount ??
    record.visibleTestsCapturedCount ??
    record.exampleTestsAvailableCount ??
    0
  );
}

function resolveTestsAvailable(record: ProblemCoverageRecord): boolean {
  return (
    record.testsAvailable ??
    record.testsFragmentArchived ??
    (record.exampleTestsAvailableCount ?? 0) > 0
  );
}

function toGuiSourceFields(
  record: ProblemCoverageRecord,
): Pick<
  GuiCoverageRecord,
  | 'officialSolutionPresent'
  | 'officialSourceArchived'
  | 'officialSourceLanguages'
  | 'officialSourceStatus'
  | 'userSourceArchived'
  | 'userSourceLanguages'
  | 'requiredTrustworthyUserSourceLanguages'
  | 'trustworthyUserSourceLanguages'
  | 'bestTrustworthyUserPerLanguage'
  | 'missingTrustworthyUserSourceLanguages'
  | 'officialSourceBlocked'
  | 'officialSourceBlockedReason'
> {
  return {
    officialSolutionPresent: record.officialSolutionPresent,
    officialSourceArchived: record.officialSourceArchived,
    officialSourceLanguages: withFallback(record.officialSourceLanguages, () => []),
    officialSourceStatus: withFallback(record.officialSourceStatus, () =>
      deriveOfficialSourceStatus(record),
    ),
    userSourceArchived: record.userSourceArchived,
    userSourceLanguages: withFallback(record.userSourceLanguages, () => []),
    requiredTrustworthyUserSourceLanguages: withFallback(
      record.requiredTrustworthyUserSourceLanguages,
      () => deriveRequiredTrustworthyLanguages(record),
    ),
    trustworthyUserSourceLanguages: withFallback(record.trustworthyUserSourceLanguages, () => []),
    bestTrustworthyUserPerLanguage: withFallback(record.bestTrustworthyUserPerLanguage, () => ({})),
    missingTrustworthyUserSourceLanguages: withFallback(
      record.missingTrustworthyUserSourceLanguages,
      () => [],
    ),
    officialSourceBlocked: withFallback(record.officialSourceBlocked, () => false),
    officialSourceBlockedReason: record.officialSourceBlockedReason,
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
    ...toGuiTestsFields(record),
    ...toGuiSourceFields(record),
    archiveCompletenessStatus:
      record.archiveCompletenessStatus ?? deriveArchiveCompletenessStatus(record),
    editorialAvailability: record.editorialAvailability,
    unsolvedByConfiguredHandle: record.unsolvedByConfiguredHandle ?? !record.solvedByMe,
    notArchivedYet: record.notArchivedYet ?? false,
    newSinceBaseline: record.newSinceBaseline ?? false,
    notes: record.notes,
  };
}

function matchesSolvedFilter(record: ProblemCoverageRecord, options: ListCoverageOptions): boolean {
  if (options.solved === 'solved') {
    return record.solvedByMe;
  }
  if (options.solved === 'unsolved') {
    return !record.solvedByMe;
  }
  return true;
}

function matchesEnumFilter<T>(
  value: T | undefined,
  filter: T | 'all' | undefined,
): boolean {
  if (!filter || filter === 'all') {
    return true;
  }
  return value === filter;
}

function matchesStructuredCoverageFilters(
  record: ProblemCoverageRecord,
  options: ListCoverageOptions,
): boolean {
  const checks: boolean[] = [
    matchesSolvedFilter(record, options),
    matchesPresenceFilter(record.testsFragmentArchived, options.testsFragmentArchived),
    matchesPresenceFilter(record.visibleTestsCapturedCount > 0, options.visibleTestsCaptured),
    matchesEnumFilter(
      record.testsCoverageStatus ?? deriveTestsCoverageStatus(record),
      options.testsCoverageStatus,
    ),
    matchesPresenceFilter(record.officialSourceArchived, options.officialSourceArchived),
    matchesPresenceFilter(record.userSourceArchived, options.userSourceArchived),
    matchesEnumFilter(record.editorialAvailability, options.editorialAvailability),
    typeof options.grade !== 'number' || record.grade === options.grade,
    matchesEnumFilter(
      record.archiveCompletenessStatus ?? deriveArchiveCompletenessStatus(record),
      options.archiveCompletenessStatus,
    ),
  ];
  return checks.every(Boolean);
}

function matchesCoverageQuery(record: ProblemCoverageRecord, query: string | undefined): boolean {
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

function matchesCoverageFilters(
  record: ProblemCoverageRecord,
  options: ListCoverageOptions,
  query: string | undefined,
): boolean {
  return (
    matchesStructuredCoverageFilters(record, options) && matchesCoverageQuery(record, query)
  );
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
  if (hasAnyCapturedTests(record)) {
    return 'captured';
  }
  if (record.testsFragmentArchived) {
    return 'not-available-upstream';
  }
  return 'not-captured-yet';
}

function hasAnyCapturedTests(
  record: Pick<
    ProblemCoverageRecord,
    | 'exampleTestsAvailableCount'
    | 'visibleTestsCapturedCount'
    | 'evaluationObservedTestsCount'
    | 'effectiveTestsAvailableCount'
  >,
): boolean {
  const counts = [
    record.effectiveTestsAvailableCount,
    record.exampleTestsAvailableCount,
    record.visibleTestsCapturedCount,
    record.evaluationObservedTestsCount,
  ];
  return counts.some((count) => (count ?? 0) > 0);
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
  return [
    ...new Set([
      ...(record.trustworthyUserSourceLanguages ?? []),
      ...(record.missingTrustworthyUserSourceLanguages ?? []),
    ]),
  ].sort();
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
    (record.missingTrustworthyUserSourceLanguages?.length ?? 0) > 0 ||
    !record.userSourceArchived
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
