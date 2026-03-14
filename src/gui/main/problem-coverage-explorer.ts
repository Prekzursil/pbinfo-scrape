import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
  GuiCoverageDetail,
  GuiCoverageEditorialFilter,
  GuiCoverageListing,
  GuiCoveragePresenceFilter,
  GuiCoverageRecord,
  GuiCoverageSolvedFilter,
  GuiCoverageSummary,
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
  officialSourceArchived?: GuiCoveragePresenceFilter;
  userSourceArchived?: GuiCoveragePresenceFilter;
  editorialAvailability?: GuiCoverageEditorialFilter;
  grade?: number;
}

export interface ReadCoverageOptions extends ExploreCoverageOptions {
  problemId: number;
}

export function getCoverageExplorerSummary(
  workspaceRoot: string,
  options: ExploreCoverageOptions = {},
): GuiCoverageSummary {
  const context = resolveCoverageContext(workspaceRoot, options.snapshotId);
  return {
    snapshotId: context.layout.snapshotId,
    coverageRoot: context.coverageRoot,
    normalizedRoot: context.layout.normalizedRoot,
    mirrorRoot: context.layout.mirrorRoot,
    mirrorServeCommand: `npm run cli -- serve --snapshot ${context.layout.snapshotId} --port 4173`,
    mirrorUrl: 'http://127.0.0.1:4173/',
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
      officialSourceFilePaths: record.officialSourceIds.map((sourceId) =>
        join(context.layout.normalizedRoot, 'sources', `${sourceId}.json`)),
      userSourceFilePaths: record.userSourceIds.map((sourceId) =>
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
    visibleTestsCapturedCount: record.visibleTestsCapturedCount,
    officialSolutionPresent: record.officialSolutionPresent,
    officialSourceArchived: record.officialSourceArchived,
    userSourceArchived: record.userSourceArchived,
    editorialAvailability: record.editorialAvailability,
    notes: record.notes,
  };
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
