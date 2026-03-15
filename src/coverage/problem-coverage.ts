import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

import { writeJsonRecord } from '../archive/json-store.js';
import {
  resolveReadableSnapshotLayout,
  type SnapshotLayout,
} from '../archive/storage.js';
import { loadLocalConfig } from '../config/local-config.js';
import { buildProblemCoverageGapReport } from './coverage-gaps.js';
import type {
  BestSubmissionRecord,
  EvaluationRecord,
  PageRecord,
  ProblemCoverageIndex,
  ProblemCoverageRecord,
  ProblemCoverageTotals,
  ProblemRecord,
  ProblemTestsRecord,
  SourceRecord,
} from '../types/records.js';

export interface ProblemCoverageWorkflowResult {
  snapshotId: string;
  generatedAt: string;
  problemsCovered: number;
  coverageRoot: string;
  indexPath: string;
  gapsPath: string;
  totals: ProblemCoverageTotals;
}

interface UserSolutionsRecord {
  user?: string;
  entries?: Array<{
    user?: string;
    problemId?: number;
    evaluationId?: number;
    score?: number;
  }>;
}

interface RankingIndexFile {
  generatedAt?: string;
  problems?: BestSubmissionRecord[];
}

export async function buildProblemCoverageDataset(
  workspaceRoot: string,
  snapshotId?: string,
): Promise<ProblemCoverageWorkflowResult> {
  const config = loadLocalConfig(workspaceRoot);
  const snapshot = resolveReadableSnapshotLayout(config, snapshotId);
  return buildProblemCoverageDatasetForSnapshot(snapshot, {
    workspaceRoot,
    configuredUserHandle: config.crawl.userHandle,
  });
}

export async function buildProblemCoverageDatasetForSnapshot(
  snapshot: SnapshotLayout,
  options: {
    workspaceRoot: string;
    configuredUserHandle?: string;
    now?: Date;
  },
): Promise<ProblemCoverageWorkflowResult> {
  const coverageRoot = join(snapshot.normalizedRoot, 'problem-coverage');
  rmSync(coverageRoot, { recursive: true, force: true });
  mkdirSync(coverageRoot, { recursive: true });

  const generatedAt = (options.now ?? new Date()).toISOString();
  const problemRecords = readJsonDirectory<ProblemRecord>(
    join(snapshot.normalizedRoot, 'problems'),
  );
  const pageRecords = readJsonDirectory<PageRecord>(
    join(snapshot.normalizedRoot, 'pages'),
  );
  const evaluationRecords = readJsonDirectory<EvaluationRecord>(
    join(snapshot.normalizedRoot, 'evaluations'),
  );
  const sourceRecords = readJsonDirectory<SourceRecord>(
    join(snapshot.normalizedRoot, 'sources'),
  );
  const testsRecords = readJsonDirectory<ProblemTestsRecord>(
    join(snapshot.normalizedRoot, 'tests'),
  );
  const userSolutionFeeds = readJsonDirectory<UserSolutionsRecord>(
    join(snapshot.normalizedRoot, 'user-solutions'),
  );
  const rankingIndex = readJsonFile<RankingIndexFile>(
    join(snapshot.normalizedRoot, 'rankings', 'best-submissions.json'),
  ) ?? { problems: [] };

  const solvedByMe = deriveSolvedProblemSets(
    options.configuredUserHandle,
    userSolutionFeeds,
    evaluationRecords,
  );
  const fragmentsByProblemId = buildProblemFragmentPresence(pageRecords);
  const evaluationsByProblemId = groupByProblemId(evaluationRecords);
  const sourcesByProblemId = groupByProblemId(sourceRecords);
  const testsByProblemId = groupByProblemId(testsRecords);
  const rankingByProblemId = new Map<number, BestSubmissionRecord>();
  for (const entry of rankingIndex.problems ?? []) {
    if (typeof entry.problemId === 'number') {
      rankingByProblemId.set(entry.problemId, entry);
    }
  }

  const records = problemRecords
    .map((problem) =>
      buildCoverageRecord(problem, {
        snapshotId: snapshot.snapshotId,
        fragments: fragmentsByProblemId.get(problem.id),
        evaluations: evaluationsByProblemId.get(problem.id) ?? [],
        sources: sourcesByProblemId.get(problem.id) ?? [],
        tests: testsByProblemId.get(problem.id)?.[0],
        ranking: rankingByProblemId.get(problem.id),
        solvedProblemIds: solvedByMe.problemIds,
        solvedEvaluationIds: solvedByMe.evaluationIds,
        configuredUserHandle: options.configuredUserHandle,
      }),
    )
    .sort((left, right) => left.problemId - right.problemId);

  for (const record of records) {
    writeJsonRecord(
      coverageRoot,
      `problem-${record.problemId}.json`,
      record,
    );
  }

  const totals = summarizeCoverageRecords(records);
  const indexPayload: ProblemCoverageIndex = {
    snapshotId: snapshot.snapshotId,
    generatedAt,
    totals,
    records,
  };
  const indexPath = writeJsonRecord(coverageRoot, 'index.json', indexPayload);
  const gapReport = buildProblemCoverageGapReport({
    normalizedRoot: snapshot.normalizedRoot,
    snapshotId: snapshot.snapshotId,
    coverageIndex: indexPayload,
    now: options.now,
  });

  return {
    snapshotId: snapshot.snapshotId,
    generatedAt,
    problemsCovered: records.length,
    coverageRoot,
    indexPath,
    gapsPath: gapReport.paths.reportPath,
    totals,
  };
}

export function readProblemCoverageIndex(
  normalizedRoot: string,
): ProblemCoverageIndex | undefined {
  return readJsonFile<ProblemCoverageIndex>(join(normalizedRoot, 'problem-coverage', 'index.json'));
}

export function readProblemCoverageRecord(
  normalizedRoot: string,
  problemId: number,
): ProblemCoverageRecord | undefined {
  return readJsonFile<ProblemCoverageRecord>(
    join(normalizedRoot, 'problem-coverage', `problem-${problemId}.json`),
  );
}

function buildCoverageRecord(
  problem: ProblemRecord,
  context: {
    snapshotId: string;
    fragments?: {
      statementArchived: boolean;
      solutionFragmentArchived: boolean;
      testsFragmentArchived: boolean;
    };
    evaluations: EvaluationRecord[];
    sources: SourceRecord[];
    tests?: ProblemTestsRecord;
    ranking?: BestSubmissionRecord;
    solvedProblemIds: Set<number>;
    solvedEvaluationIds: Set<number>;
    configuredUserHandle?: string;
  },
): ProblemCoverageRecord {
  const fragments = context.fragments ?? {
    statementArchived: false,
    solutionFragmentArchived: false,
    testsFragmentArchived: false,
  };
  const officialSources = context.sources.filter((source) => source.kind === 'official');
  const userSources = context.sources.filter((source) => source.kind !== 'official');
  const testsRecord = context.tests;
  const exampleTestsAvailableCount = testsRecord?.examples.length ?? problem.examples.length ?? 0;
  const visibleTestsCapturedCount = testsRecord?.visible.length ?? problem.visibleTests?.length ?? 0;
  const evaluationObservedTestsCount = testsRecord?.evaluationObserved.length ?? 0;
  const solvedEvaluationCount = context.evaluations.filter((evaluation) =>
    context.solvedEvaluationIds.has(evaluation.evaluationId)
  ).length;
  const officialSolutionPresent =
    fragments.solutionFragmentArchived
    || Object.keys(problem.officialSolutions ?? {}).length > 0;
  const record: ProblemCoverageRecord = {
    snapshotId: context.snapshotId,
    problemId: problem.id,
    slug: problem.slug,
    name: problem.name,
    grade: problem.grade,
    canonicalUrl: problem.canonicalUrl,
    mirrorRoute: deriveProblemMirrorRoute(problem),
    tags: problem.tags ?? [],
    solvedByMe: context.solvedProblemIds.has(problem.id),
    evaluationCount: context.evaluations.length,
    solvedEvaluationCount,
    rankingPresent: Boolean(context.ranking),
    statementArchived: fragments.statementArchived,
    solutionFragmentArchived: fragments.solutionFragmentArchived,
    testsFragmentArchived: fragments.testsFragmentArchived,
    exampleTestsAvailableCount,
    visibleTestsCapturedCount,
    evaluationObservedTestsCount,
    officialSolutionPresent,
    editorialAvailability: problem.editorialAvailability ?? 'unknown',
    sourceListUrl: problem.sourceListUrl,
    officialSourceArchived: officialSources.length > 0,
    officialSourceCount: officialSources.length,
    officialSourceIds: officialSources.map((source) => source.sourceId),
    userSourceArchived: userSources.length > 0,
    userSourceCount: userSources.length,
    userSourceIds: userSources.map((source) => source.sourceId),
    hasAnyArchivedSource: officialSources.length + userSources.length > 0,
    evaluationIds: context.evaluations
      .map((evaluation) => evaluation.evaluationId)
      .sort((left, right) => right - left),
    bestUserOverallEvaluationId: context.ranking?.bestUserOverallEvaluationId,
    notes: [],
  };
  record.notes = deriveCoverageNotes(record);
  return record;
}

function deriveCoverageNotes(record: ProblemCoverageRecord): string[] {
  const notes: string[] = [];
  if (record.solutionFragmentArchived && !record.officialSourceArchived) {
    notes.push('Editorial/solution fragment archived, but official source code is not archived yet.');
  }
  if (record.testsFragmentArchived && record.visibleTestsCapturedCount === 0) {
    notes.push('Tests fragment archived, no visible test cases parsed.');
  }
  if (record.exampleTestsAvailableCount > 0) {
    notes.push(`Example tests available: ${record.exampleTestsAvailableCount}.`);
  }
  if (record.evaluationObservedTestsCount > 0) {
    notes.push(`Evaluation-observed tests archived: ${record.evaluationObservedTestsCount}.`);
  }
  if (record.sourceListUrl && !record.hasAnyArchivedSource) {
    notes.push('Source list available upstream, no archived source code yet.');
  }
  if (record.solvedByMe && record.solvedEvaluationCount === 0) {
    notes.push('Solved by archived handle, but no normalized evaluation detail is archived yet.');
  }
  return notes;
}

function deriveProblemMirrorRoute(problem: ProblemRecord): string {
  if (problem.canonicalUrl) {
    const parsed = new URL(problem.canonicalUrl);
    return `${parsed.pathname}${parsed.search}`;
  }
  return `/probleme/${problem.id}/${problem.slug}`;
}

function summarizeCoverageRecords(
  records: ProblemCoverageRecord[],
): ProblemCoverageTotals {
  return {
    totalProblems: records.length,
    solvedByMeCount: records.filter((record) => record.solvedByMe).length,
    statementArchivedCount: records.filter((record) => record.statementArchived).length,
    solutionFragmentArchivedCount: records.filter((record) => record.solutionFragmentArchived).length,
    testsFragmentArchivedCount: records.filter((record) => record.testsFragmentArchived).length,
    problemsWithExamples: records.filter((record) => record.exampleTestsAvailableCount > 0).length,
    problemsWithVisibleTestsCaptured: records.filter(
      (record) => record.visibleTestsCapturedCount > 0,
    ).length,
    problemsWithEvaluationObservedTests: records.filter(
      (record) => record.evaluationObservedTestsCount > 0,
    ).length,
    problemsWithArchivedSources: records.filter((record) => record.hasAnyArchivedSource).length,
    problemsWithOfficialSourceArchived: records.filter(
      (record) => record.officialSourceArchived,
    ).length,
    problemsWithUserSourceArchived: records.filter((record) => record.userSourceArchived).length,
    editorialVisibleCount: records.filter(
      (record) => record.editorialAvailability === 'visible',
    ).length,
    rankingPresentCount: records.filter((record) => record.rankingPresent).length,
  };
}

function deriveSolvedProblemSets(
  configuredUserHandle: string | undefined,
  feeds: UserSolutionsRecord[],
  evaluations: EvaluationRecord[],
): {
  problemIds: Set<number>;
  evaluationIds: Set<number>;
} {
  const problemIds = new Set<number>();
  const evaluationIds = new Set<number>();
  const evaluationsById = new Map<number, EvaluationRecord>();
  for (const evaluation of evaluations) {
    evaluationsById.set(evaluation.evaluationId, evaluation);
  }

  for (const feed of feeds) {
    const feedMatchesConfiguredUser =
      !configuredUserHandle || matchesConfiguredHandle(configuredUserHandle, feed.user);

    for (const entry of feed.entries ?? []) {
      const entryUser = entry.user?.trim();
      if (entryUser) {
        if (!matchesConfiguredHandle(configuredUserHandle, entryUser)) {
          continue;
        }
      } else if (!feedMatchesConfiguredUser) {
        continue;
      }

      const evaluation =
        typeof entry.evaluationId === 'number'
          ? evaluationsById.get(entry.evaluationId)
          : undefined;
      if (evaluation) {
        if (!isSolvedEvaluation(evaluation)) {
          continue;
        }
        problemIds.add(evaluation.problemId);
        evaluationIds.add(evaluation.evaluationId);
        continue;
      }

      if ((entry.score ?? 0) < 100) {
        continue;
      }
      if (typeof entry.problemId === 'number') {
        problemIds.add(entry.problemId);
      }
      if (typeof entry.evaluationId === 'number') {
        evaluationIds.add(entry.evaluationId);
      }
    }
  }

  for (const evaluation of evaluations) {
    if (
      matchesConfiguredHandle(configuredUserHandle, evaluation.user)
      && isSolvedEvaluation(evaluation)
    ) {
      problemIds.add(evaluation.problemId);
      evaluationIds.add(evaluation.evaluationId);
    }
  }

  return {
    problemIds,
    evaluationIds,
  };
}

function isSolvedEvaluation(evaluation: EvaluationRecord): boolean {
  return typeof evaluation.score === 'number' && evaluation.score >= 100;
}

function matchesConfiguredHandle(
  configuredUserHandle: string | undefined,
  candidate: string | undefined,
): boolean {
  if (!configuredUserHandle) {
    return true;
  }
  if (!candidate) {
    return false;
  }

  const normalizedConfigured = configuredUserHandle.trim().toLowerCase();
  const normalizedCandidate = candidate.trim().toLowerCase();
  return (
    normalizedCandidate === normalizedConfigured
    || normalizedCandidate.includes(`(${normalizedConfigured})`)
    || normalizedCandidate.includes(` ${normalizedConfigured}`)
  );
}

function buildProblemFragmentPresence(
  pages: PageRecord[],
): Map<number, { statementArchived: boolean; solutionFragmentArchived: boolean; testsFragmentArchived: boolean }> {
  const byProblemId = new Map<
    number,
    {
      statementArchived: boolean;
      solutionFragmentArchived: boolean;
      testsFragmentArchived: boolean;
    }
  >();

  for (const page of pages) {
    const problemId = extractProblemIdFromPage(page);
    if (!problemId) {
      continue;
    }
    const current = byProblemId.get(problemId) ?? {
      statementArchived: false,
      solutionFragmentArchived: false,
      testsFragmentArchived: false,
    };
    if (page.kind === 'problem-statement') {
      current.statementArchived = true;
    }
    if (page.kind === 'problem-solution') {
      current.solutionFragmentArchived = true;
    }
    if (page.kind === 'problem-tests') {
      current.testsFragmentArchived = true;
    }
    byProblemId.set(problemId, current);
  }

  return byProblemId;
}

function extractProblemIdFromPage(page: PageRecord): number | undefined {
  const url = new URL(page.url);
  if (
    page.kind === 'problem-statement'
    || page.kind === 'problem-solution'
    || page.kind === 'problem-tests'
  ) {
    const id = url.searchParams.get('id');
    return id ? Number(id) : undefined;
  }

  const problemMatch = url.pathname.match(/^\/probleme\/(\d+)\/[^/]+/);
  if (problemMatch?.[1]) {
    return Number(problemMatch[1]);
  }

  const solutionMatch = url.pathname.match(/^\/solutii\/problema\/(\d+)\/[^/]+/);
  if (solutionMatch?.[1]) {
    return Number(solutionMatch[1]);
  }

  return undefined;
}

function groupByProblemId<T extends { problemId: number }>(records: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const record of records) {
    const current = grouped.get(record.problemId) ?? [];
    current.push(record);
    grouped.set(record.problemId, current);
  }
  return grouped;
}

function readJsonDirectory<T>(root: string): T[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readJsonFile<T>(join(root, entry)))
    .filter((payload): payload is T => Boolean(payload));
}

function readJsonFile<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
