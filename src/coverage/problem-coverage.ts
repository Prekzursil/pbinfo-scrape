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
import { parseProblemSourceListPage } from '../pbinfo/parsers/problem-source-list.js';
import { buildProblemCoverageGapReport } from './coverage-gaps.js';
import { normalizeLanguage } from '../ranking/source-normalization.js';
import type {
  BestSubmissionRecord,
  EvaluationRecord,
  OfficialSourceHarvestRecord,
  ProblemArchiveCompletenessStatus,
  PageRecord,
  ProblemCoverageIndex,
  ProblemCoverageRecord,
  ProblemCoverageTotals,
  ProblemOfficialSourceStatus,
  ProblemRecord,
  ProblemTestsCoverageStatus,
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

const DEFAULT_BASELINE_SNAPSHOT_ID = 'acceptance-20260310b';

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
  const baselineCoverageByProblemId = readBaselineCoverageByProblemId(
    options.workspaceRoot,
    snapshot.snapshotId,
  );
  const officialSourceHarvestByProblemId = buildOfficialSourceHarvestByProblemId(
    snapshot,
    pageRecords,
  );

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
        baseline: baselineCoverageByProblemId.get(problem.id),
        officialSourceHarvest:
          problem.officialSourceHarvest
          ?? officialSourceHarvestByProblemId.get(problem.id),
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

interface CoverageRecordContext {
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
  baseline?: ProblemCoverageRecord;
  officialSourceHarvest?: OfficialSourceHarvestRecord;
}

interface CoverageSourceMetrics {
  qualifyingOfficialSources: SourceRecord[];
  harvestedOfficialEvaluations: EvaluationRecord[];
  userSources: SourceRecord[];
  officialSourceIds: string[];
  userSourceIds: string[];
  officialSourceLanguages: string[];
  userSourceLanguages: string[];
  bestTrustworthyUserPerLanguage: Record<string, number>;
  trustworthyUserSourceLanguages: string[];
  requiredTrustworthyUserSourceLanguages: string[];
  missingTrustworthyUserSourceLanguages: string[];
}

interface CoverageTestsMetrics {
  exampleTestsAvailableCount: number;
  visibleTestsCapturedCount: number;
  evaluationObservedTestsCount: number;
  effectiveTestsAvailableCount: number;
}

function computeSourceMetrics(
  problem: ProblemRecord,
  context: CoverageRecordContext,
): CoverageSourceMetrics {
  const qualifyingOfficialSources = context.sources
    .filter((source) => source.kind === 'official')
    .filter(isCoverageSatisfyingOfficialSource);
  const harvestedOfficialEvaluationIds =
    context.officialSourceHarvest?.qualifyingEvaluationIds ?? [];
  const harvestedOfficialEvaluations = context.evaluations.filter((evaluation) =>
    harvestedOfficialEvaluationIds.includes(evaluation.evaluationId),
  );
  const userSources = context.sources.filter(
    (source) =>
      source.kind === 'user-evaluation' &&
      source.sourceAvailable &&
      matchesConfiguredHandle(context.configuredUserHandle, source.userHandle),
  );
  const bestTrustworthyUserPerLanguage = context.ranking?.bestTrustworthyPerLanguage ?? {};
  const trustworthyUserSourceLanguages = uniqueSorted(
    Object.keys(bestTrustworthyUserPerLanguage).map(normalizeCoverageLanguage),
  );
  const requiredTrustworthyUserSourceLanguages = uniqueSorted(
    context.evaluations
      .filter(
        (evaluation) =>
          matchesConfiguredHandle(context.configuredUserHandle, evaluation.user) &&
          isSolvedEvaluation(evaluation),
      )
      .map((evaluation) => normalizeCoverageLanguage(evaluation.language)),
  );

  return {
    qualifyingOfficialSources,
    harvestedOfficialEvaluations,
    userSources,
    officialSourceIds: qualifyingOfficialSources.map((source) => source.sourceId).sort(),
    userSourceIds: userSources.map((source) => source.sourceId).sort(),
    officialSourceLanguages: uniqueSorted(
      qualifyingOfficialSources.map((source) => normalizeCoverageLanguage(source.language)),
    ),
    userSourceLanguages: uniqueSorted(
      userSources.map((source) => normalizeCoverageLanguage(source.language)),
    ),
    bestTrustworthyUserPerLanguage,
    trustworthyUserSourceLanguages,
    requiredTrustworthyUserSourceLanguages,
    missingTrustworthyUserSourceLanguages: requiredTrustworthyUserSourceLanguages.filter(
      (language) => !trustworthyUserSourceLanguages.includes(language),
    ),
  };
}

function firstCount(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return 0;
}

function computeTestsMetrics(
  problem: ProblemRecord,
  testsRecord: ProblemTestsRecord | undefined,
): CoverageTestsMetrics {
  return {
    exampleTestsAvailableCount: firstCount(testsRecord?.examples.length, problem.examples.length),
    visibleTestsCapturedCount: firstCount(
      testsRecord?.visible.length,
      problem.visibleTests?.length,
    ),
    evaluationObservedTestsCount: firstCount(testsRecord?.evaluationObserved.length),
    effectiveTestsAvailableCount: firstCount(
      testsRecord?.effective?.length,
      testsRecord?.examples?.length,
    ),
  };
}

function computeNotArchivedYet(
  fragments: {
    statementArchived: boolean;
    solutionFragmentArchived: boolean;
    testsFragmentArchived: boolean;
  },
  officialSourceCount: number,
  userSourceCount: number,
  evaluationCount: number,
): boolean {
  return (
    !fragments.statementArchived &&
    !fragments.solutionFragmentArchived &&
    !fragments.testsFragmentArchived &&
    officialSourceCount === 0 &&
    userSourceCount === 0 &&
    evaluationCount === 0
  );
}

function computeOfficialSourceBlocked(
  officialSourceCount: number,
  blockedReason: ProblemCoverageRecord['officialSourceBlockedReason'],
): boolean {
  return (
    officialSourceCount === 0 &&
    blockedReason !== undefined &&
    blockedReason !== 'not-available-upstream'
  );
}

function buildCoverageRecord(
  problem: ProblemRecord,
  context: CoverageRecordContext,
): ProblemCoverageRecord {
  const fragments = context.fragments ?? {
    statementArchived: false,
    solutionFragmentArchived: false,
    testsFragmentArchived: false,
  };
  const sourceMetrics = computeSourceMetrics(problem, context);
  const {
    qualifyingOfficialSources,
    harvestedOfficialEvaluations,
    userSources,
    officialSourceIds,
    userSourceIds,
    officialSourceLanguages,
    userSourceLanguages,
    bestTrustworthyUserPerLanguage,
    trustworthyUserSourceLanguages,
    requiredTrustworthyUserSourceLanguages,
    missingTrustworthyUserSourceLanguages,
  } = sourceMetrics;
  const testsMetrics = computeTestsMetrics(problem, context.tests);
  const {
    exampleTestsAvailableCount,
    visibleTestsCapturedCount,
    evaluationObservedTestsCount,
    effectiveTestsAvailableCount,
  } = testsMetrics;
  const solvedEvaluationCount = context.evaluations.filter((evaluation) =>
    context.solvedEvaluationIds.has(evaluation.evaluationId)
  ).length;
  const officialSolutionPresent =
    fragments.solutionFragmentArchived
    || Object.keys(problem.officialSolutions ?? {}).length > 0;
  const testsCoverageStatus = deriveTestsCoverageStatus({
    testsFragmentArchived: fragments.testsFragmentArchived,
    exampleTestsAvailableCount,
    visibleTestsCapturedCount,
    evaluationObservedTestsCount,
    effectiveTestsAvailableCount,
  });
  const officialSourceStatus = deriveOfficialSourceStatus(
    problem,
    qualifyingOfficialSources,
    harvestedOfficialEvaluations,
    context.officialSourceHarvest,
  );
  const officialSourceBlockedReason = deriveOfficialSourceBlockedReason(
    problem,
    fragments,
    qualifyingOfficialSources,
    officialSourceStatus,
  );
  const solvedByMe = context.solvedProblemIds.has(problem.id);
  const testsAvailable = testsCoverageStatus === 'captured';
  const notArchivedYet = computeNotArchivedYet(
    fragments,
    qualifyingOfficialSources.length,
    userSources.length,
    context.evaluations.length,
  );
  const archiveCompletenessStatus = deriveArchiveCompletenessStatus({
    solvedByMe,
    notArchivedYet,
    testsCoverageStatus,
    officialSourceStatus,
    missingTrustworthyUserSourceLanguages,
    userSourceArchived: userSources.length > 0,
  });
  const record: ProblemCoverageRecord = {
    snapshotId: context.snapshotId,
    problemId: problem.id,
    slug: problem.slug,
    name: problem.name,
    grade: problem.grade,
    canonicalUrl: problem.canonicalUrl,
    mirrorRoute: deriveProblemMirrorRoute(problem),
    tags: problem.tags ?? [],
    solvedByMe,
    evaluationCount: context.evaluations.length,
    solvedEvaluationCount,
    rankingPresent: Boolean(context.ranking),
    statementArchived: fragments.statementArchived,
    solutionFragmentArchived: fragments.solutionFragmentArchived,
    testsFragmentArchived: fragments.testsFragmentArchived,
    exampleTestsAvailableCount,
    visibleTestsCapturedCount,
    evaluationObservedTestsCount,
    effectiveTestsAvailableCount,
    testsCoverageStatus,
    officialSolutionPresent,
    editorialAvailability: problem.editorialAvailability ?? 'unknown',
    sourceListUrl: problem.sourceListUrl,
    officialSourceArchived: qualifyingOfficialSources.length > 0,
    officialSourceCount: qualifyingOfficialSources.length,
    officialSourceIds,
    officialSourceLanguages,
    officialSourceStatus,
    userSourceArchived: userSources.length > 0,
    userSourceCount: userSources.length,
    userSourceIds,
    userSourceLanguages,
    requiredTrustworthyUserSourceLanguages,
    trustworthyUserSourceLanguages,
    bestTrustworthyUserPerLanguage,
    missingTrustworthyUserSourceLanguages,
    archiveCompletenessStatus,
    hasAnyArchivedSource: qualifyingOfficialSources.length + userSources.length > 0,
    testsAvailable,
    unsolvedByConfiguredHandle: !solvedByMe,
    officialSourceBlocked: computeOfficialSourceBlocked(
      qualifyingOfficialSources.length,
      officialSourceBlockedReason,
    ),
    officialSourceBlockedReason,
    notArchivedYet,
    newSinceBaseline: didCoverageImproveSinceBaseline(context.baseline, {
      effectiveTestsAvailableCount,
      visibleTestsCapturedCount,
      evaluationObservedTestsCount,
      officialSourceCount: qualifyingOfficialSources.length,
      userSourceCount: userSources.length,
      trustworthyUserSourceLanguages,
      solvedByMe,
    }),
    evaluationIds: context.evaluations
      .map((evaluation) => evaluation.evaluationId)
      .sort((left, right) => right - left),
    bestUserOverallEvaluationId: context.ranking?.bestUserOverallEvaluationId,
    notes: [],
  };
  record.notes = deriveCoverageNotes(record);
  return record;
}

interface CoverageNoteRule {
  applies: (record: ProblemCoverageRecord) => boolean;
  note: (record: ProblemCoverageRecord) => string;
}

const COVERAGE_NOTE_RULES: readonly CoverageNoteRule[] = [
  {
    applies: (record) => record.solutionFragmentArchived && !record.officialSourceArchived,
    note: () => 'Editorial/solution fragment archived, but official source code is not archived yet.',
  },
  {
    applies: (record) => Boolean(record.sourceListUrl) && !record.officialSourceArchived,
    note: () =>
      'Community source list exists upstream, but it is not counted as archived official source code.',
  },
  {
    applies: (record) => record.testsFragmentArchived && record.visibleTestsCapturedCount === 0,
    note: () => 'Tests fragment archived, no visible test cases parsed.',
  },
  {
    applies: (record) => record.testsCoverageStatus === 'not-available-upstream',
    note: () =>
      'PBInfo does not currently expose example, visible, or evaluation-observed tests for this problem in the archive.',
  },
  {
    applies: (record) => record.testsCoverageStatus === 'not-captured-yet',
    note: () =>
      'Tests are not captured yet for this problem; re-run statement/tests/evaluation crawling if test evidence is expected.',
  },
  {
    applies: (record) => record.exampleTestsAvailableCount > 0,
    note: (record) => `Example tests available: ${record.exampleTestsAvailableCount}.`,
  },
  {
    applies: (record) => record.effectiveTestsAvailableCount > 0,
    note: (record) =>
      `Effective deduplicated tests available: ${record.effectiveTestsAvailableCount}.`,
  },
  {
    applies: (record) => record.evaluationObservedTestsCount > 0,
    note: (record) => `Evaluation-observed tests archived: ${record.evaluationObservedTestsCount}.`,
  },
  {
    applies: (record) => record.solvedByMe && record.solvedEvaluationCount === 0,
    note: () => 'Solved by archived handle, but no normalized evaluation detail is archived yet.',
  },
  {
    applies: (record) => record.missingTrustworthyUserSourceLanguages.length > 0,
    note: (record) =>
      `Missing trustworthy 100-point user source languages: ${record.missingTrustworthyUserSourceLanguages.join(', ')}.`,
  },
  {
    applies: (record) =>
      record.officialSourceStatus === 'not-available-upstream' && !record.sourceListUrl,
    note: () => 'PBInfo does not currently list an upstream official source page for this problem.',
  },
  {
    applies: (record) =>
      record.officialSourceStatus === 'not-available-upstream' && Boolean(record.sourceListUrl),
    note: () =>
      'Official source harvest completed, but PBInfo does not expose a qualifying 100-point official source body for this problem.',
  },
  {
    applies: (record) => record.officialSourceStatus === 'restricted-upstream',
    note: () => 'PBInfo restricts official/editorial source access for this problem upstream.',
  },
  {
    applies: (record) => record.requiredTrustworthyUserSourceLanguages.length > 0,
    note: (record) =>
      `Solved 100-point languages for this handle: ${record.requiredTrustworthyUserSourceLanguages.join(', ')}.`,
  },
  {
    applies: (record) => record.newSinceBaseline,
    note: () => `Coverage improved relative to baseline snapshot ${DEFAULT_BASELINE_SNAPSHOT_ID}.`,
  },
];

function deriveCoverageNotes(record: ProblemCoverageRecord): string[] {
  return COVERAGE_NOTE_RULES.filter((rule) => rule.applies(record)).map((rule) => rule.note(record));
}

function deriveProblemMirrorRoute(problem: ProblemRecord): string {
  if (problem.canonicalUrl) {
    const parsed = new URL(problem.canonicalUrl);
    return `${parsed.pathname}${parsed.search}`;
  }
  return `/probleme/${problem.id}/${problem.slug}`;
}

function buildOfficialSourceHarvestByProblemId(
  snapshot: SnapshotLayout,
  pageRecords: PageRecord[],
): Map<number, OfficialSourceHarvestRecord> {
  const byProblemId = new Map<number, OfficialSourceHarvestRecord>();
  for (const page of pageRecords) {
    if (page.kind !== 'official-source-list') {
      continue;
    }

    const match = page.url.match(/^https:\/\/www\.pbinfo\.ro\/solutii\/user\/([^/?#]+)\/problema\/(\d+)\/([^/?#]+)/);
    if (!match?.[2]) {
      continue;
    }

    const problemId = Number(match[2]);
    if (!Number.isFinite(problemId)) {
      continue;
    }

    const html = readArchivedPageBody(snapshot, page);
    if (!html) {
      continue;
    }

    const parsed = parseProblemSourceListPage(html, page.url);
    const harvest: OfficialSourceHarvestRecord = {
      sourceListHarvested: true,
      sourceListPageUrl: page.url,
      authorHandle: parsed.authorHandle ?? match[1],
      qualifyingEvaluationIds: parsed.entries
        .filter((entry) => typeof entry.score !== 'number' || entry.score >= 100)
        .map((entry) => entry.evaluationId),
    };
    byProblemId.set(problemId, harvest);
  }
  return byProblemId;
}

function readArchivedPageBody(
  snapshot: SnapshotLayout,
  page: PageRecord,
): string | undefined {
  const candidate = page.browserBodyPath ?? page.bodyPath;
  if (!candidate) {
    return undefined;
  }

  const normalizedCandidate = candidate.replace(/^raw-pages[\\/]/, '');
  const fullPath = join(snapshot.rawPagesRoot, normalizedCandidate);
  if (!existsSync(fullPath)) {
    return undefined;
  }

  try {
    return readFileSync(fullPath, 'utf8');
  } catch {
    return undefined;
  }
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
    problemsWithEffectiveTests: records.filter(
      (record) => record.effectiveTestsAvailableCount > 0,
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
    newSinceBaselineCount: records.filter((record) => record.newSinceBaseline).length,
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
  const sets: SolvedProblemSets = { problemIds: new Set<number>(), evaluationIds: new Set<number>() };
  const evaluationsById = new Map<number, EvaluationRecord>();
  for (const evaluation of evaluations) {
    evaluationsById.set(evaluation.evaluationId, evaluation);
  }

  for (const feed of feeds) {
    collectSolvedFromFeed(feed, configuredUserHandle, evaluationsById, sets);
  }

  for (const evaluation of evaluations) {
    if (
      matchesConfiguredHandle(configuredUserHandle, evaluation.user) &&
      isSolvedEvaluation(evaluation)
    ) {
      addSolved(sets, evaluation.problemId, evaluation.evaluationId);
    }
  }

  return sets;
}

interface SolvedProblemSets {
  problemIds: Set<number>;
  evaluationIds: Set<number>;
}

function addSolved(sets: SolvedProblemSets, problemId?: number, evaluationId?: number): void {
  if (typeof problemId === 'number') {
    sets.problemIds.add(problemId);
  }
  if (typeof evaluationId === 'number') {
    sets.evaluationIds.add(evaluationId);
  }
}

function entryMatchesConfiguredUser(
  entryUser: string | undefined,
  feedMatchesConfiguredUser: boolean,
  configuredUserHandle: string | undefined,
): boolean {
  if (entryUser) {
    return matchesConfiguredHandle(configuredUserHandle, entryUser);
  }
  return feedMatchesConfiguredUser;
}

function collectSolvedFromFeed(
  feed: UserSolutionsRecord,
  configuredUserHandle: string | undefined,
  evaluationsById: Map<number, EvaluationRecord>,
  sets: SolvedProblemSets,
): void {
  const feedMatchesConfiguredUser =
    !configuredUserHandle || matchesConfiguredHandle(configuredUserHandle, feed.user);

  for (const entry of feed.entries ?? []) {
    if (
      entryMatchesConfiguredUser(entry.user?.trim(), feedMatchesConfiguredUser, configuredUserHandle)
    ) {
      collectSolvedFromEntry(entry, evaluationsById, sets);
    }
  }
}

function collectSolvedFromEntry(
  entry: NonNullable<UserSolutionsRecord['entries']>[number],
  evaluationsById: Map<number, EvaluationRecord>,
  sets: SolvedProblemSets,
): void {
  const evaluation =
    typeof entry.evaluationId === 'number' ? evaluationsById.get(entry.evaluationId) : undefined;
  if (evaluation) {
    if (isSolvedEvaluation(evaluation)) {
      addSolved(sets, evaluation.problemId, evaluation.evaluationId);
    }
    return;
  }

  if ((entry.score ?? 0) >= 100) {
    addSolved(sets, entry.problemId, entry.evaluationId);
  }
}

function isSolvedEvaluation(evaluation: EvaluationRecord): boolean {
  return typeof evaluation.score === 'number' && evaluation.score >= 100;
}

function isCoverageSatisfyingOfficialSource(source: SourceRecord): boolean {
  return source.kind === 'official'
    && source.sourceAvailable
    && typeof source.score === 'number'
    && source.score >= 100
    && source.provenanceType !== 'official-fragment';
}

function deriveTestsCoverageStatus(input: {
  testsFragmentArchived: boolean;
  exampleTestsAvailableCount: number;
  visibleTestsCapturedCount: number;
  evaluationObservedTestsCount: number;
  effectiveTestsAvailableCount: number;
}): ProblemTestsCoverageStatus {
  if (
    input.effectiveTestsAvailableCount > 0
    || input.exampleTestsAvailableCount > 0
    || input.visibleTestsCapturedCount > 0
    || input.evaluationObservedTestsCount > 0
  ) {
    return 'captured';
  }

  if (input.testsFragmentArchived) {
    return 'not-available-upstream';
  }

  return 'not-captured-yet';
}

function harvestIndicatesNoUpstreamSource(
  harvestedOfficialEvaluations: EvaluationRecord[],
  officialSourceHarvest: OfficialSourceHarvestRecord,
): boolean {
  const candidateEvaluationIds = officialSourceHarvest.qualifyingEvaluationIds ?? [];
  if (candidateEvaluationIds.length === 0) {
    return true;
  }
  return (
    harvestedOfficialEvaluations.length === candidateEvaluationIds.length &&
    harvestedOfficialEvaluations.every((evaluation) => !evaluation.sourceAvailable)
  );
}

function deriveOfficialSourceStatus(
  problem: ProblemRecord,
  qualifyingOfficialSources: SourceRecord[],
  harvestedOfficialEvaluations: EvaluationRecord[],
  officialSourceHarvest: OfficialSourceHarvestRecord | undefined,
): ProblemOfficialSourceStatus {
  if (qualifyingOfficialSources.length > 0) {
    return 'archived';
  }
  if (problem.editorialAvailability === 'hidden' || problem.editorialAvailability === 'restricted') {
    return 'restricted-upstream';
  }
  if (
    officialSourceHarvest?.sourceListHarvested &&
    harvestIndicatesNoUpstreamSource(harvestedOfficialEvaluations, officialSourceHarvest)
  ) {
    return 'not-available-upstream';
  }
  if (!problem.sourceListUrl?.trim()) {
    return 'not-available-upstream';
  }
  return 'not-captured-yet';
}

function deriveOfficialSourceBlockedReason(
  problem: ProblemRecord,
  fragments: {
    statementArchived: boolean;
    solutionFragmentArchived: boolean;
    testsFragmentArchived: boolean;
  },
  qualifyingOfficialSources: SourceRecord[],
  officialSourceStatus: ProblemOfficialSourceStatus,
): string | undefined {
  if (qualifyingOfficialSources.length > 0) {
    return undefined;
  }
  if (officialSourceStatus === 'not-available-upstream') {
    return 'not-available-upstream';
  }
  if (problem.editorialAvailability === 'hidden') {
    return 'editorial-hidden';
  }
  if (problem.editorialAvailability === 'restricted') {
    return 'editorial-restricted';
  }
  if (!fragments.solutionFragmentArchived) {
    return 'solution-fragment-not-archived';
  }
  return 'official-source-not-captured';
}

function deriveArchiveCompletenessStatus(input: {
  solvedByMe: boolean;
  notArchivedYet: boolean;
  testsCoverageStatus: ProblemTestsCoverageStatus;
  officialSourceStatus: ProblemOfficialSourceStatus;
  missingTrustworthyUserSourceLanguages: string[];
  userSourceArchived: boolean;
}): ProblemArchiveCompletenessStatus {
  if (input.notArchivedYet) {
    return 'not-archived-yet';
  }
  if (!input.solvedByMe) {
    return 'unsolved';
  }
  if (
    input.missingTrustworthyUserSourceLanguages.length > 0
    || !input.userSourceArchived
  ) {
    return 'missing-user-source';
  }
  if (input.officialSourceStatus === 'not-captured-yet') {
    return 'missing-official-source';
  }
  if (input.testsCoverageStatus === 'not-captured-yet') {
    return 'incomplete';
  }
  return 'complete';
}

function didCoverageImproveSinceBaseline(
  baseline: ProblemCoverageRecord | undefined,
  current: {
    effectiveTestsAvailableCount: number;
    visibleTestsCapturedCount: number;
    evaluationObservedTestsCount: number;
    officialSourceCount: number;
    userSourceCount: number;
    trustworthyUserSourceLanguages: string[];
    solvedByMe: boolean;
  },
): boolean {
  if (!baseline) {
    return hasAnyCoverageEvidence(current);
  }
  return coverageExceedsBaseline(baseline, current);
}

interface CoverageBaselineComparison {
  effectiveTestsAvailableCount: number;
  visibleTestsCapturedCount: number;
  evaluationObservedTestsCount: number;
  officialSourceCount: number;
  userSourceCount: number;
  trustworthyUserSourceLanguages: string[];
  solvedByMe: boolean;
}

function hasAnyCoverageEvidence(current: CoverageBaselineComparison): boolean {
  return (
    current.effectiveTestsAvailableCount > 0 ||
    current.visibleTestsCapturedCount > 0 ||
    current.evaluationObservedTestsCount > 0 ||
    current.officialSourceCount > 0 ||
    current.userSourceCount > 0 ||
    current.trustworthyUserSourceLanguages.length > 0 ||
    current.solvedByMe
  );
}

function coverageExceedsBaseline(
  baseline: ProblemCoverageRecord,
  current: CoverageBaselineComparison,
): boolean {
  const baselineEffectiveTests = firstCount(
    baseline.effectiveTestsAvailableCount,
    baseline.visibleTestsCapturedCount,
  );
  const comparisons: Array<[number, number]> = [
    [current.effectiveTestsAvailableCount, baselineEffectiveTests],
    [current.visibleTestsCapturedCount, baseline.visibleTestsCapturedCount ?? 0],
    [current.evaluationObservedTestsCount, baseline.evaluationObservedTestsCount ?? 0],
    [current.officialSourceCount, baseline.officialSourceCount ?? 0],
    [current.userSourceCount, baseline.userSourceCount ?? 0],
    [
      current.trustworthyUserSourceLanguages.length,
      (baseline.trustworthyUserSourceLanguages ?? []).length,
    ],
  ];
  if (comparisons.some(([currentValue, baselineValue]) => currentValue > baselineValue)) {
    return true;
  }
  return current.solvedByMe && !baseline.solvedByMe;
}

function normalizeCoverageLanguage(language: string | undefined): string {
  return normalizeLanguage(language) ?? (language ?? 'unknown').trim().toLowerCase();
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
    .sort((left, right) => left.localeCompare(right));
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

function readBaselineCoverageByProblemId(
  workspaceRoot: string,
  activeSnapshotId: string,
): Map<number, ProblemCoverageRecord> {
  if (activeSnapshotId === DEFAULT_BASELINE_SNAPSHOT_ID) {
    return new Map();
  }

  const config = loadLocalConfig(workspaceRoot);
  const baselineLayout = resolveReadableSnapshotLayout(config, DEFAULT_BASELINE_SNAPSHOT_ID);
  const baselineIndex = readProblemCoverageIndex(baselineLayout.normalizedRoot);
  const byProblemId = new Map<number, ProblemCoverageRecord>();
  for (const record of baselineIndex?.records ?? []) {
    byProblemId.set(record.problemId, record);
  }
  return byProblemId;
}
