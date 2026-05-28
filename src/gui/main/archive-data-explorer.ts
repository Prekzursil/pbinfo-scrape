import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveReadableSnapshotLayout } from '../../archive/storage.js';
import { loadLocalConfig } from '../../config/local-config.js';
import type {
  EvaluationRecord,
  MirrorRouteRecord,
  ProblemRecord,
  ProblemTestsRecord,
} from '../../types/records.js';
import type {
  GuiArchiveDataset,
  GuiArchiveDatasetSummary,
  GuiArchiveListing,
  GuiArchiveRecordDetail,
  GuiArchiveRecordSummary,
  GuiArchiveSummary,
} from '../shared/types.js';

const DEFAULT_LIST_LIMIT = 24;

interface RankingIndexFile {
  generatedAt?: string;
  problems?: Array<{
    problemId?: number;
    bestUserOverallEvaluationId?: number;
    bestUserPerLanguage?: Record<string, number>;
    bestOfficialPerLanguage?: Record<string, string>;
    orderedUserEvaluationIds?: number[];
  }>;
}

interface ExploreArchiveOptions {
  snapshotId?: string;
}

interface ListArchiveDatasetOptions extends ExploreArchiveOptions {
  dataset: GuiArchiveDataset;
  query?: string;
  offset?: number;
  limit?: number;
}

interface ReadArchiveRecordOptions extends ExploreArchiveOptions {
  dataset: GuiArchiveDataset;
  recordId: string;
}

export function getArchiveExplorerSummary(
  workspaceRoot: string,
  options: ExploreArchiveOptions = {},
): GuiArchiveSummary {
  const context = resolveExplorerContext(workspaceRoot, options.snapshotId);
  return {
    snapshotId: context.layout.snapshotId,
    normalizedRoot: context.layout.normalizedRoot,
    mirrorRoot: context.layout.mirrorRoot,
    mirrorServeCommand: `npm run cli -- serve --snapshot ${context.layout.snapshotId} --port 4173`,
    mirrorUrl: 'http://127.0.0.1:4173/',
    datasets: [
      buildDatasetSummary(
        'problems',
        'Problems',
        context.problemsRoot,
        countJsonFiles(context.problemsRoot),
        'Structured PBInfo problem records with sections, examples, constraints, and official-source metadata.',
      ),
      buildDatasetSummary(
        'evaluations',
        'Evaluations',
        context.evaluationsRoot,
        countJsonFiles(context.evaluationsRoot),
        'Submission and evaluation records with score, verdict, tests, and compile logs when archived.',
      ),
      buildDatasetSummary(
        'tests',
        'Tests',
        context.testsRoot,
        countJsonFiles(context.testsRoot),
        'Unified per-problem test dataset combining statement examples, visible tests, and evaluation-observed tests.',
      ),
      buildDatasetSummary(
        'rankings',
        'Rankings',
        context.rankingsRoot,
        countRankingEntries(context.rankingsIndexPath),
        'Canonical best-user and best-official language rankings derived from normalized evaluation sources.',
      ),
      buildDatasetSummary(
        'mirror-routes',
        'Mirror Routes',
        context.routesRoot,
        countMirrorRouteEntries(context.routesManifestPath, context.routesRoot),
        'Route records that drive local mirror replay and link archived entities back into the offline viewer.',
      ),
    ],
  };
}

export function listArchiveExplorerRecords(
  workspaceRoot: string,
  options: ListArchiveDatasetOptions,
): GuiArchiveListing {
  const context = resolveExplorerContext(workspaceRoot, options.snapshotId);
  const limit = options.limit ?? DEFAULT_LIST_LIMIT;
  const offset = options.offset ?? 0;
  const query = normalizeQuery(options.query);
  const allItems = buildDatasetItems(context, options.dataset, query);
  const items = allItems.slice(offset, offset + limit);

  return {
    snapshotId: context.layout.snapshotId,
    dataset: options.dataset,
    totalCount: allItems.length,
    offset,
    limit,
    items,
  };
}

export function readArchiveExplorerRecord(
  workspaceRoot: string,
  options: ReadArchiveRecordOptions,
): GuiArchiveRecordDetail {
  const context = resolveExplorerContext(workspaceRoot, options.snapshotId);
  switch (options.dataset) {
    case 'problems':
      return readProblemRecordDetail(context, options.recordId);
    case 'evaluations':
      return readEvaluationRecordDetail(context, options.recordId);
    case 'tests':
      return readTestsRecordDetail(context, options.recordId);
    case 'rankings':
      return readRankingRecordDetail(context, options.recordId);
    case 'mirror-routes':
      return readMirrorRouteRecordDetail(context, options.recordId);
  }
}

interface ExplorerContext {
  layout: ReturnType<typeof resolveReadableSnapshotLayout>;
  problemsRoot: string;
  evaluationsRoot: string;
  testsRoot: string;
  rankingsRoot: string;
  rankingProblemsRoot: string;
  rankingsIndexPath: string;
  routesRoot: string;
  routesManifestPath: string;
}

function resolveExplorerContext(workspaceRoot: string, snapshotId?: string): ExplorerContext {
  const config = loadLocalConfig(workspaceRoot);
  const layout = resolveReadableSnapshotLayout(config, snapshotId);
  return {
    layout,
    problemsRoot: join(layout.normalizedRoot, 'problems'),
    evaluationsRoot: join(layout.normalizedRoot, 'evaluations'),
    testsRoot: join(layout.normalizedRoot, 'tests'),
    rankingsRoot: join(layout.normalizedRoot, 'rankings'),
    rankingProblemsRoot: join(layout.normalizedRoot, 'rankings', 'problems'),
    rankingsIndexPath: join(layout.normalizedRoot, 'rankings', 'best-submissions.json'),
    routesRoot: join(layout.normalizedRoot, 'routes'),
    routesManifestPath: join(layout.mirrorRoot, 'routes.json'),
  };
}

function buildDatasetSummary(
  dataset: GuiArchiveDataset,
  label: string,
  directoryPath: string,
  count: number,
  description: string,
): GuiArchiveDatasetSummary {
  return {
    dataset,
    label,
    count,
    directoryPath,
    description,
  };
}

function buildDatasetItems(
  context: ExplorerContext,
  dataset: GuiArchiveDataset,
  query: string | undefined,
): GuiArchiveRecordSummary[] {
  switch (dataset) {
    case 'problems':
      return listProblemItems(context, query);
    case 'evaluations':
      return listEvaluationItems(context, query);
    case 'tests':
      return listTestsItems(context, query);
    case 'rankings':
      return listRankingItems(context, query);
    case 'mirror-routes':
      return listMirrorRouteItems(context, query);
  }
}

function listProblemItems(
  context: ExplorerContext,
  query: string | undefined,
): GuiArchiveRecordSummary[] {
  return readJsonDirectory<ProblemRecord>(context.problemsRoot)
    .map(({ payload, filePath }) => ({
      dataset: 'problems' as const,
      recordId: String(payload.id),
      title: `#${payload.id} ${payload.name}`,
      subtitle: payload.canonicalUrl ? extractPathname(payload.canonicalUrl) : undefined,
      description:
        payload.constraints.length > 0 ? payload.constraints.slice(0, 2).join(' • ') : undefined,
      filePath,
      mirrorRoute: deriveProblemRoute(payload),
    }))
    .filter((item) => matchesQuery(item, query))
    .sort((left, right) => compareNumericIds(left.recordId, right.recordId));
}

function listEvaluationItems(
  context: ExplorerContext,
  query: string | undefined,
): GuiArchiveRecordSummary[] {
  return readJsonDirectory<EvaluationRecord>(context.evaluationsRoot)
    .map(({ payload, filePath }) => ({
      dataset: 'evaluations' as const,
      recordId: String(payload.evaluationId),
      title: `#${payload.evaluationId} ${payload.problemName}`,
      subtitle: `${payload.language} • ${payload.score}p • ${payload.verdictSummary}`,
      description: payload.user,
      filePath,
      mirrorRoute: `/detalii-evaluare/${payload.evaluationId}`,
    }))
    .filter((item) => matchesQuery(item, query))
    .sort((left, right) => compareNumericIds(right.recordId, left.recordId));
}

function listTestsItems(
  context: ExplorerContext,
  query: string | undefined,
): GuiArchiveRecordSummary[] {
  return readJsonDirectory<ProblemTestsRecord>(context.testsRoot)
    .map(({ payload, filePath }) => ({
      dataset: 'tests' as const,
      recordId: String(payload.problemId),
      title: `#${payload.problemId} ${payload.problemName}`,
      subtitle: `examples: ${payload.examples.length} • visible: ${payload.visible.length} • evaluation-observed: ${payload.evaluationObserved.length}`,
      description: payload.problemSlug,
      filePath,
      mirrorRoute: `/probleme/${payload.problemId}/${payload.problemSlug}`,
    }))
    .filter((item) => matchesQuery(item, query))
    .sort((left, right) => compareNumericIds(left.recordId, right.recordId));
}

function listRankingItems(
  context: ExplorerContext,
  query: string | undefined,
): GuiArchiveRecordSummary[] {
  const rankingIndex = readRankingIndex(context.rankingsIndexPath);
  return (rankingIndex.problems ?? [])
    .filter(
      (entry): entry is NonNullable<typeof rankingIndex.problems>[number] & { problemId: number } =>
        typeof entry.problemId === 'number',
    )
    .map((entry) => {
      const rankingPath = join(context.rankingProblemsRoot, `problem-${entry.problemId}.json`);
      const problemRecord = readJsonFile<ProblemRecord>(
        join(context.problemsRoot, `problem-${entry.problemId}.json`),
      );
      const languages = Object.keys(entry.bestUserPerLanguage ?? {});
      return {
        dataset: 'rankings' as const,
        recordId: String(entry.problemId),
        title: problemRecord
          ? `#${entry.problemId} ${problemRecord.name}`
          : `Problem #${entry.problemId}`,
        subtitle:
          languages.length > 0
            ? `Best user languages: ${languages.join(', ')}`
            : 'No language winners recorded',
        description: entry.bestUserOverallEvaluationId
          ? `Best user overall evaluation: ${entry.bestUserOverallEvaluationId}`
          : 'No overall best user evaluation recorded',
        filePath: existsSync(rankingPath) ? rankingPath : context.rankingsIndexPath,
        mirrorRoute: problemRecord ? deriveProblemRoute(problemRecord) : undefined,
      };
    })
    .filter((item) => matchesQuery(item, query))
    .sort((left, right) => compareNumericIds(left.recordId, right.recordId));
}

function listMirrorRouteItems(
  context: ExplorerContext,
  query: string | undefined,
): GuiArchiveRecordSummary[] {
  const manifestRoutes = readJsonFile<MirrorRouteRecord[]>(context.routesManifestPath);
  const records =
    manifestRoutes && manifestRoutes.length > 0
      ? manifestRoutes.map((payload) => ({
          payload,
          filePath: context.routesManifestPath,
        }))
      : readJsonDirectory<MirrorRouteRecord>(context.routesRoot);

  return records
    .map(({ payload, filePath }) => ({
      dataset: 'mirror-routes' as const,
      recordId: payload.route,
      title: payload.route,
      subtitle: payload.template,
      description: payload.sourceUrl ?? payload.entityKey,
      filePath,
      mirrorRoute: payload.route,
    }))
    .filter((item) => matchesQuery(item, query))
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
}

function readProblemRecordDetail(
  context: ExplorerContext,
  recordId: string,
): GuiArchiveRecordDetail {
  const filePath = join(context.problemsRoot, `problem-${recordId}.json`);
  const payload = requireJsonFile<ProblemRecord>(filePath);
  return {
    snapshotId: context.layout.snapshotId,
    dataset: 'problems',
    recordId,
    title: `#${payload.id} ${payload.name}`,
    subtitle: payload.canonicalUrl ? extractPathname(payload.canonicalUrl) : undefined,
    filePath,
    mirrorRoute: deriveProblemRoute(payload),
    payload,
  };
}

function readEvaluationRecordDetail(
  context: ExplorerContext,
  recordId: string,
): GuiArchiveRecordDetail {
  const filePath = join(context.evaluationsRoot, `evaluation-${recordId}.json`);
  const payload = requireJsonFile<EvaluationRecord>(filePath);
  return {
    snapshotId: context.layout.snapshotId,
    dataset: 'evaluations',
    recordId,
    title: `#${payload.evaluationId} ${payload.problemName}`,
    subtitle: `${payload.language} • ${payload.score}p • ${payload.verdictSummary}`,
    filePath,
    mirrorRoute: `/detalii-evaluare/${payload.evaluationId}`,
    payload,
  };
}

function readTestsRecordDetail(context: ExplorerContext, recordId: string): GuiArchiveRecordDetail {
  const filePath = join(context.testsRoot, `problem-${recordId}.json`);
  const payload = requireJsonFile<ProblemTestsRecord>(filePath);
  return {
    snapshotId: context.layout.snapshotId,
    dataset: 'tests',
    recordId,
    title: `#${payload.problemId} ${payload.problemName}`,
    subtitle: `examples: ${payload.examples.length} • visible: ${payload.visible.length} • evaluation-observed: ${payload.evaluationObserved.length}`,
    filePath,
    mirrorRoute: `/probleme/${payload.problemId}/${payload.problemSlug}`,
    payload,
  };
}

function readRankingRecordDetail(
  context: ExplorerContext,
  recordId: string,
): GuiArchiveRecordDetail {
  const rankingPath = join(context.rankingProblemsRoot, `problem-${recordId}.json`);
  const index = readRankingIndex(context.rankingsIndexPath);
  const indexEntry = (index.problems ?? []).find((entry) => String(entry.problemId) === recordId);
  if (!indexEntry) {
    throw new Error(`Ranking record "${recordId}" was not found.`);
  }

  const payload = readJsonFile<Record<string, unknown>>(rankingPath) ?? indexEntry;
  const problemRecord = readJsonFile<ProblemRecord>(
    join(context.problemsRoot, `problem-${recordId}.json`),
  );

  return {
    snapshotId: context.layout.snapshotId,
    dataset: 'rankings',
    recordId,
    title: problemRecord ? `#${recordId} ${problemRecord.name}` : `Problem #${recordId}`,
    subtitle: indexEntry.bestUserOverallEvaluationId
      ? `Best user overall evaluation: ${indexEntry.bestUserOverallEvaluationId}`
      : 'No overall best user evaluation recorded',
    filePath: existsSync(rankingPath) ? rankingPath : context.rankingsIndexPath,
    mirrorRoute: problemRecord ? deriveProblemRoute(problemRecord) : undefined,
    payload,
  };
}

function readMirrorRouteRecordDetail(
  context: ExplorerContext,
  recordId: string,
): GuiArchiveRecordDetail {
  const manifestRoutes = readJsonFile<MirrorRouteRecord[]>(context.routesManifestPath);
  const manifestMatch = manifestRoutes?.find((route) => route.route === recordId);
  const payload =
    manifestMatch ??
    readJsonDirectory<MirrorRouteRecord>(context.routesRoot).find(
      (record) => record.payload.route === recordId,
    )?.payload;
  if (!payload) {
    throw new Error(`Mirror route "${recordId}" was not found.`);
  }

  return {
    snapshotId: context.layout.snapshotId,
    dataset: 'mirror-routes',
    recordId,
    title: payload.route,
    subtitle: payload.template,
    filePath: manifestMatch
      ? context.routesManifestPath
      : join(context.routesRoot, `route-${sanitizeRouteRecordId(recordId)}.json`),
    mirrorRoute: payload.route,
    payload,
  };
}

function countJsonFiles(root: string): number {
  if (!existsSync(root)) {
    return 0;
  }

  return readdirSync(root).filter((entry) => entry.toLowerCase().endsWith('.json')).length;
}

function countRankingEntries(indexPath: string): number {
  return readRankingIndex(indexPath).problems?.length ?? 0;
}

function countMirrorRouteEntries(manifestPath: string, fallbackRoot: string): number {
  const manifest = readJsonFile<MirrorRouteRecord[]>(manifestPath);
  if (manifest) {
    return manifest.length;
  }

  return countJsonFiles(fallbackRoot);
}

function readRankingIndex(path: string): RankingIndexFile {
  return (
    readJsonFile<RankingIndexFile>(path) ?? {
      problems: [],
    }
  );
}

function readJsonDirectory<T>(root: string): Array<{ payload: T; filePath: string }> {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root)
    .filter((entry) => entry.toLowerCase().endsWith('.json'))
    .flatMap((entry) => {
      const filePath = join(root, entry);
      const payload = readJsonFile<T>(filePath);
      return payload ? [{ payload, filePath }] : [];
    });
}

function requireJsonFile<T>(filePath: string): T {
  const payload = readJsonFile<T>(filePath);
  if (!payload) {
    throw new Error(`Archive record ${filePath} is missing or unreadable.`);
  }
  return payload;
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

function normalizeQuery(query: string | undefined): string | undefined {
  const trimmed = query?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function matchesQuery(item: GuiArchiveRecordSummary, query: string | undefined): boolean {
  if (!query) {
    return true;
  }

  const haystacks = [item.recordId, item.title, item.subtitle, item.description, item.mirrorRoute]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.toLowerCase());
  return haystacks.some((value) => value.includes(query));
}

function compareNumericIds(left: string, right: string): number {
  const leftNumeric = Number(left);
  const rightNumeric = Number(right);
  if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) {
    return leftNumeric - rightNumeric;
  }

  return left.localeCompare(right);
}

function deriveProblemRoute(problem: ProblemRecord): string | undefined {
  if (problem.canonicalUrl) {
    return extractPathname(problem.canonicalUrl);
  }
  if (problem.id) {
    return `/probleme/${problem.id}/${problem.slug}`;
  }
  return undefined;
}

function extractPathname(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

function sanitizeRouteRecordId(route: string): string {
  return route.replaceAll('/', '-').replace(/^-+/, '');
}
