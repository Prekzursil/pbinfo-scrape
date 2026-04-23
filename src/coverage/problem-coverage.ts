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
  EvaluationTimelineEntry,
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
  ProgressState,
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
    baseline?: ProblemCoverageRecord;
    officialSourceHarvest?: OfficialSourceHarvestRecord;
  },
): ProblemCoverageRecord {
  const fragments = context.fragments ?? {
    statementArchived: false,
    solutionFragmentArchived: false,
    testsFragmentArchived: false,
  };
  const officialSources = context.sources.filter(
    (source) => source.kind === 'official',
  );
  const qualifyingOfficialSources = officialSources.filter(isCoverageSatisfyingOfficialSource);
  const harvestedOfficialEvaluationIds =
    context.officialSourceHarvest?.qualifyingEvaluationIds ?? [];
  const harvestedOfficialEvaluations = context.evaluations.filter((evaluation) =>
    harvestedOfficialEvaluationIds.includes(evaluation.evaluationId)
  );
  const userSources = context.sources.filter(
    (source) =>
      source.kind === 'user-evaluation'
      && source.sourceAvailable
      && matchesConfiguredHandle(context.configuredUserHandle, source.userHandle),
  );
  const testsRecord = context.tests;
  const exampleTestsAvailableCount = testsRecord?.examples.length ?? problem.examples.length ?? 0;
  const visibleTestsCapturedCount = testsRecord?.visible.length ?? problem.visibleTests?.length ?? 0;
  const evaluationObservedTestsCount = testsRecord?.evaluationObserved.length ?? 0;
  const effectiveTestsAvailableCount = testsRecord?.effective?.length
    ?? testsRecord?.examples?.length
    ?? 0;
  const solvedEvaluationCount = context.evaluations.filter((evaluation) =>
    context.solvedEvaluationIds.has(evaluation.evaluationId)
  ).length;
  const officialSolutionPresent =
    fragments.solutionFragmentArchived
    || Object.keys(problem.officialSolutions ?? {}).length > 0;
  const officialSourceIds = qualifyingOfficialSources
    .map((source) => source.sourceId)
    .sort();
  const userSourceIds = userSources
    .map((source) => source.sourceId)
    .sort();
  const officialSourceLanguages = uniqueSorted(
    qualifyingOfficialSources.map((source) => normalizeCoverageLanguage(source.language)),
  );
  const userSourceLanguages = uniqueSorted(
    userSources.map((source) => normalizeCoverageLanguage(source.language)),
  );
  const bestTrustworthyUserPerLanguage = context.ranking?.bestTrustworthyPerLanguage ?? {};
  const trustworthyUserSourceLanguages = uniqueSorted(
    Object.keys(bestTrustworthyUserPerLanguage).map(normalizeCoverageLanguage),
  );
  const requiredTrustworthyUserSourceLanguages = uniqueSorted(
    context.evaluations
      .filter((evaluation) =>
        matchesConfiguredHandle(context.configuredUserHandle, evaluation.user)
        && isSolvedEvaluation(evaluation),
      )
      .map((evaluation) => normalizeCoverageLanguage(evaluation.language)),
  );
  const missingTrustworthyUserSourceLanguages = requiredTrustworthyUserSourceLanguages.filter(
    (language) => !trustworthyUserSourceLanguages.includes(language),
  );
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
  const notArchivedYet =
    !fragments.statementArchived
    && !fragments.solutionFragmentArchived
    && !fragments.testsFragmentArchived
    && qualifyingOfficialSources.length === 0
    && userSources.length === 0
    && context.evaluations.length === 0;
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
    officialSourceBlocked:
      qualifyingOfficialSources.length === 0
      && officialSourceBlockedReason !== undefined
      && officialSourceBlockedReason !== 'not-available-upstream',
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
    progressState: deriveProgressState(solvedByMe, context.evaluations.length),
    bestScore: deriveBestScore(context.evaluations),
    lastAttemptAt: deriveLastAttemptAt(context.evaluations),
    evaluationTimeline: buildEvaluationTimeline(context.evaluations),
    languagesTried: uniqueSorted(
      context.evaluations.map((evaluation) => normalizeCoverageLanguage(evaluation.language)),
    ),
    requiredTestsCaptured: exampleTestsAvailableCount + visibleTestsCapturedCount > 0,
  };
  record.notes = deriveCoverageNotes(record);
  return record;
}

function deriveProgressState(solvedByMe: boolean, evaluationCount: number): ProgressState {
  if (solvedByMe) {
    return 'solved';
  }
  if (evaluationCount > 0) {
    return 'partial';
  }
  return 'not-attempted';
}

function deriveBestScore(evaluations: ReadonlyArray<EvaluationRecord>): number {
  let best = 0;
  for (const evaluation of evaluations) {
    if (Number.isFinite(evaluation.score) && evaluation.score > best) {
      best = evaluation.score;
    }
  }
  return best;
}

function deriveLastAttemptAt(
  evaluations: ReadonlyArray<EvaluationRecord>,
): string | undefined {
  let latest: string | undefined;
  for (const evaluation of evaluations) {
    const candidate = evaluation.fetchedAt;
    if (!candidate) {
      continue;
    }
    if (!latest || candidate > latest) {
      latest = candidate;
    }
  }
  return latest;
}

function buildEvaluationTimeline(
  evaluations: ReadonlyArray<EvaluationRecord>,
): EvaluationTimelineEntry[] {
  return evaluations
    .map((evaluation): EvaluationTimelineEntry => ({
      evaluationId: evaluation.evaluationId,
      language: evaluation.language,
      score: evaluation.score,
      verdictSummary: evaluation.verdictSummary,
      fetchedAt: evaluation.fetchedAt,
      runtimeSeconds: evaluation.runtimeSeconds,
      memoryKb: evaluation.memoryKb,
      // Operator rule: only 100pt sources are retained; lower scores have
      // metadata only. This mirrors the eventual storage gate.
      sourceAvailable:
        evaluation.sourceAvailable === true && evaluation.score >= 100,
    }))
    .sort((a, b) => {
      const ta = a.fetchedAt ?? '';
      const tb = b.fetchedAt ?? '';
      if (ta && tb) {
        return tb.localeCompare(ta);
      }
      return b.evaluationId - a.evaluationId;
    });
}

function deriveCoverageNotes(record: ProblemCoverageRecord): string[] {
  const notes: string[] = [];
  if (record.solutionFragmentArchived && !record.officialSourceArchived) {
    notes.push('Editorial/solution fragment archived, but official source code is not archived yet.');
  }
  if (record.sourceListUrl && !record.officialSourceArchived) {
    notes.push('Community source list exists upstream, but it is not counted as archived official source code.');
  }
  if (record.testsFragmentArchived && record.visibleTestsCapturedCount === 0) {
    notes.push('Tests fragment archived, no visible test cases parsed.');
  }
  if (record.testsCoverageStatus === 'not-available-upstream') {
    notes.push(
      'PBInfo does not currently expose example, visible, or evaluation-observed tests for this problem in the archive.',
    );
  }
  if (record.testsCoverageStatus === 'not-captured-yet') {
    notes.push(
      'Tests are not captured yet for this problem; re-run statement/tests/evaluation crawling if test evidence is expected.',
    );
  }
  if (record.exampleTestsAvailableCount > 0) {
    notes.push(`Example tests available: ${record.exampleTestsAvailableCount}.`);
  }
  if (record.effectiveTestsAvailableCount > 0) {
    notes.push(`Effective deduplicated tests available: ${record.effectiveTestsAvailableCount}.`);
  }
  if (record.evaluationObservedTestsCount > 0) {
    notes.push(`Evaluation-observed tests archived: ${record.evaluationObservedTestsCount}.`);
  }
  if (record.solvedByMe && record.solvedEvaluationCount === 0) {
    notes.push('Solved by archived handle, but no normalized evaluation detail is archived yet.');
  }
  if (record.missingTrustworthyUserSourceLanguages.length > 0) {
    notes.push(
      `Missing trustworthy 100-point user source languages: ${record.missingTrustworthyUserSourceLanguages.join(', ')}.`,
    );
  }
  if (
    record.officialSourceStatus === 'not-available-upstream'
    && !record.sourceListUrl
  ) {
    notes.push('PBInfo does not currently list an upstream official source page for this problem.');
  }
  if (
    record.officialSourceStatus === 'not-available-upstream'
    && record.sourceListUrl
  ) {
    notes.push('Official source harvest completed, but PBInfo does not expose a qualifying 100-point official source body for this problem.');
  }
  if (record.officialSourceStatus === 'restricted-upstream') {
    notes.push('PBInfo restricts official/editorial source access for this problem upstream.');
  }
  if (record.requiredTrustworthyUserSourceLanguages.length > 0) {
    notes.push(
      `Solved 100-point languages for this handle: ${record.requiredTrustworthyUserSourceLanguages.join(', ')}.`,
    );
  }
  if (record.newSinceBaseline) {
    notes.push(`Coverage improved relative to baseline snapshot ${DEFAULT_BASELINE_SNAPSHOT_ID}.`);
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
    progressStateCounts: {
      solved: records.filter((record) => record.progressState === 'solved').length,
      partial: records.filter((record) => record.progressState === 'partial').length,
      notAttempted: records.filter(
        (record) => record.progressState === 'not-attempted' || record.progressState === undefined,
      ).length,
    },
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
  if (officialSourceHarvest?.sourceListHarvested) {
    const candidateEvaluationIds = officialSourceHarvest.qualifyingEvaluationIds ?? [];
    if (candidateEvaluationIds.length === 0) {
      return 'not-available-upstream';
    }
    if (
      harvestedOfficialEvaluations.length === candidateEvaluationIds.length
      && harvestedOfficialEvaluations.every((evaluation) => !evaluation.sourceAvailable)
    ) {
      return 'not-available-upstream';
    }
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
    return current.effectiveTestsAvailableCount > 0
      || current.visibleTestsCapturedCount > 0
      || current.evaluationObservedTestsCount > 0
      || current.officialSourceCount > 0
      || current.userSourceCount > 0
      || current.trustworthyUserSourceLanguages.length > 0
      || current.solvedByMe;
  }

  const baselineEffectiveTests = baseline.effectiveTestsAvailableCount ?? baseline.visibleTestsCapturedCount ?? 0;
  const baselineVisibleTests = baseline.visibleTestsCapturedCount ?? 0;
  const baselineEvaluationObserved = baseline.evaluationObservedTestsCount ?? 0;
  const baselineOfficialSourceCount = baseline.officialSourceCount ?? 0;
  const baselineUserSourceCount = baseline.userSourceCount ?? 0;
  const baselineTrustworthyLanguages = baseline.trustworthyUserSourceLanguages ?? [];

  return current.effectiveTestsAvailableCount > baselineEffectiveTests
    || current.visibleTestsCapturedCount > baselineVisibleTests
    || current.evaluationObservedTestsCount > baselineEvaluationObserved
    || current.officialSourceCount > baselineOfficialSourceCount
    || current.userSourceCount > baselineUserSourceCount
    || current.trustworthyUserSourceLanguages.length > baselineTrustworthyLanguages.length
    || (current.solvedByMe && !baseline.solvedByMe);
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
