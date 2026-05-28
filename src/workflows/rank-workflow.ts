import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveReadableSnapshotLayout } from '../archive/storage.js';
import { loadLocalConfig } from '../config/local-config.js';
import { detectSuspicionFlags } from '../crawl/archive-crawler.js';
import { rankProblemSubmissions } from '../ranking/rank-submissions.js';
import type { BestSubmissionRecord, SourceRecord, SubmissionRecord } from '../types/records.js';

export interface RankingWorkflowResult {
  problemsRanked: number;
  outputPath: string;
}

export async function runRankingWorkflow(
  workspaceRoot: string,
  snapshotId?: string,
): Promise<RankingWorkflowResult> {
  const config = loadLocalConfig(workspaceRoot);
  const snapshot = resolveReadableSnapshotLayout(config, snapshotId);
  const evaluationsRoot = join(snapshot.normalizedRoot, 'evaluations');
  const sourcesRoot = join(snapshot.normalizedRoot, 'sources');
  const rankingsRoot = join(snapshot.normalizedRoot, 'rankings');
  const perProblemRoot = join(rankingsRoot, 'problems');
  mkdirSync(rankingsRoot, { recursive: true });
  rmSync(perProblemRoot, { recursive: true, force: true });
  mkdirSync(perProblemRoot, { recursive: true });
  const overrides = loadRankingOverrides(config.ranking.overridesPath);

  const evaluations = loadEvaluationRecords(evaluationsRoot).filter((evaluation) =>
    matchesConfiguredHandle(config.crawl.userHandle, evaluation.user),
  );
  const sources = loadSourceRecords(sourcesRoot);
  const grouped = new Map<number, SubmissionRecord[]>();
  for (const evaluation of evaluations) {
    const bucket = grouped.get(evaluation.problemId) ?? [];
    bucket.push(evaluation);
    grouped.set(evaluation.problemId, bucket);
  }
  const groupedSources = new Map<number, SourceRecord[]>();
  for (const source of sources) {
    const bucket = groupedSources.get(source.problemId) ?? [];
    bucket.push(source);
    groupedSources.set(source.problemId, bucket);
  }
  const problemIds = new Set<number>([...grouped.keys(), ...groupedSources.keys()]);

  const summary = {
    generatedAt: new Date().toISOString(),
    problems: [...problemIds]
      .sort((left, right) => left - right)
      .map((problemId) => {
        const submissions = grouped.get(problemId) ?? [];
        const officialSources = (groupedSources.get(problemId) ?? []).filter(
          (source) => source.kind === 'official',
        );
        const ranked = rankProblemSubmissions(submissions, officialSources, {
          forcedBestEvaluationIds: overrides[String(problemId)],
        });
        const perProblem = toBestSubmissionRecord(problemId, ranked);
        writeFileSync(
          join(perProblemRoot, `problem-${problemId}.json`),
          JSON.stringify(perProblem, null, 2),
          'utf8',
        );
        return perProblem;
      }),
  };

  const outputPath = join(rankingsRoot, 'best-submissions.json');
  writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf8');

  return {
    problemsRanked: summary.problems.length,
    outputPath,
  };
}

function toBestSubmissionRecord(
  problemId: number,
  ranked: ReturnType<typeof rankProblemSubmissions>,
): BestSubmissionRecord {
  return {
    problemId,
    bestUserOverallEvaluationId: ranked.bestUserOverallEvaluationId,
    bestUserPerLanguage: ranked.bestUserPerLanguage,
    bestTrustworthyOverallEvaluationId: ranked.bestTrustworthyOverallEvaluationId,
    bestTrustworthyPerLanguage: ranked.bestTrustworthyPerLanguage,
    bestFastPerLanguage: ranked.bestFastPerLanguage,
    bestOfficialPerLanguage: ranked.bestOfficialPerLanguage,
    suspiciousCandidateEvaluationIds: ranked.suspiciousCandidateEvaluationIds,
    duplicateEvaluationIds: ranked.duplicateEvaluationIds,
    orderedUserEvaluationIds: ranked.orderedUserEvaluationIds,
  };
}

function loadSuspicionRefreshedRecords<T extends { sourceCode?: string; suspicionFlags?: string[] }>(
  root: string,
): T[] {
  try {
    return readdirSync(root)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => refreshSuspicionFlags(JSON.parse(readFileSync(join(root, entry), 'utf8')) as T));
  } catch {
    return [];
  }
}

function loadEvaluationRecords(root: string): SubmissionRecord[] {
  return loadSuspicionRefreshedRecords<SubmissionRecord>(root);
}

function loadSourceRecords(root: string): SourceRecord[] {
  return loadSuspicionRefreshedRecords<SourceRecord>(root);
}

function refreshSuspicionFlags<T extends { sourceCode?: string; suspicionFlags?: string[] }>(
  record: T,
): T {
  if (!record.sourceCode) {
    return {
      ...record,
      suspicionFlags: [...(record.suspicionFlags ?? [])],
    };
  }

  return {
    ...record,
    suspicionFlags: detectSuspicionFlags(record.sourceCode),
  };
}

function loadRankingOverrides(overridesPath: string): Record<string, Record<string, number>> {
  try {
    return JSON.parse(readFileSync(overridesPath, 'utf8')) as Record<
      string,
      Record<string, number>
    >;
  } catch {
    return {};
  }
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
    normalizedCandidate === normalizedConfigured ||
    normalizedCandidate.includes(`(${normalizedConfigured})`) ||
    normalizedCandidate.includes(` ${normalizedConfigured}`)
  );
}
