import {
  buildSourceSignature,
  normalizeLanguage,
} from './source-normalization.js';
import { detectSuspicionFlags } from '../crawl/source-suspicion.js';
import type {
  RankedProblemSubmissions,
  SourceRecord,
  SubmissionRecord,
} from '../types/records.js';

export interface RankingOptions {
  forcedBestEvaluationIds?: Record<string, number>;
}

interface RankedSubmissionCandidate extends SubmissionRecord {
  normalizedLanguage: string;
  dedupeKey: string;
  normalizedSourceHash?: string;
  effectiveSuspicionFlags: string[];
}

export function rankProblemSubmissions(
  submissions: SubmissionRecord[],
  officialSourcesOrOptions: SourceRecord[] | RankingOptions = [],
  maybeOptions: RankingOptions = {},
): RankedProblemSubmissions {
  const officialSources = Array.isArray(officialSourcesOrOptions)
    ? officialSourcesOrOptions
    : [];
  const options = Array.isArray(officialSourcesOrOptions)
    ? maybeOptions
    : officialSourcesOrOptions;
  const forcedBest = options.forcedBestEvaluationIds ?? {};
  const candidates = submissions.map(toCandidate);
  const { representatives, duplicateEvaluationIds } = dedupeCandidates(candidates, forcedBest);

  const trustworthyPerLanguage = rankPerLanguage(
    representatives.filter(isTrustworthyCandidate),
    forcedBest,
    compareTrustworthyCandidates,
  );
  const fastPerLanguage = rankPerLanguage(
    representatives,
    forcedBest,
    compareFastCandidates,
  );

  const bestTrustworthyOverall = Object.values(trustworthyPerLanguage.candidates).sort(
    (left, right) => compareTrustworthyCandidates(left, right, forcedBest),
  )[0];
  const bestFastOverall = [...representatives].sort((left, right) =>
    compareFastCandidates(left, right, forcedBest),
  )[0];
  const suspiciousCandidateEvaluationIds = representatives
    .filter((candidate) => candidate.effectiveSuspicionFlags.length > 0)
    .sort((left, right) => compareFastCandidates(left, right, forcedBest))
    .map((candidate) => candidate.evaluationId);

  return {
    bestUserOverallEvaluationId:
      bestTrustworthyOverall?.evaluationId ?? bestFastOverall?.evaluationId,
    bestUserPerLanguage: Object.fromEntries(
      Object.entries(fastPerLanguage.ids).map(([language, evaluationId]) => [
        language,
        trustworthyPerLanguage.ids[language] ?? evaluationId,
      ]),
    ),
    bestTrustworthyOverallEvaluationId: bestTrustworthyOverall?.evaluationId,
    bestTrustworthyPerLanguage: trustworthyPerLanguage.ids,
    bestFastPerLanguage: fastPerLanguage.ids,
    bestOfficialPerLanguage: rankOfficialSources(officialSources),
    suspiciousCandidateEvaluationIds,
    duplicateEvaluationIds,
    orderedUserEvaluationIds: [...representatives]
      .sort((left, right) => compareTrustworthyCandidates(left, right, forcedBest))
      .map((candidate) => candidate.evaluationId),
  };
}

function toCandidate(submission: SubmissionRecord): RankedSubmissionCandidate {
  const normalizedLanguage = normalizeLanguage(submission.language) ?? submission.language;
  const signature = buildSourceSignature(submission.sourceCode, normalizedLanguage);
  const dedupeKey =
    signature?.normalizedSourceHash
      ? `${normalizedLanguage}:${signature.normalizedSourceHash}`
      : `${normalizedLanguage}:evaluation:${submission.evaluationId}`;

  return {
    ...submission,
    normalizedLanguage,
    normalizedSourceHash: signature?.normalizedSourceHash,
    dedupeKey,
    effectiveSuspicionFlags: normalizeBlockingSuspicionFlags(
      submission.sourceCode
        ? detectSuspicionFlags(submission.sourceCode)
        : submission.suspicionFlags,
      submission.sourceCode,
    ),
  };
}

function dedupeCandidates(
  submissions: RankedSubmissionCandidate[],
  forcedBest: Record<string, number>,
): {
  representatives: RankedSubmissionCandidate[];
  duplicateEvaluationIds: number[];
} {
  const buckets = new Map<string, RankedSubmissionCandidate[]>();
  for (const submission of submissions) {
    const bucket = buckets.get(submission.dedupeKey) ?? [];
    bucket.push(submission);
    buckets.set(submission.dedupeKey, bucket);
  }

  const representatives: RankedSubmissionCandidate[] = [];
  const duplicateEvaluationIds: number[] = [];
  for (const bucket of buckets.values()) {
    const representative = [...bucket].sort((left, right) =>
      compareTrustworthyCandidates(left, right, forcedBest),
    )[0];
    /* v8 ignore next 3 -- each bucket holds at least one candidate, so [0] is always defined */
    if (!representative) {
      continue;
    }

    representatives.push(representative);
    for (const candidate of bucket) {
      if (candidate.evaluationId !== representative.evaluationId) {
        duplicateEvaluationIds.push(candidate.evaluationId);
      }
    }
  }

  duplicateEvaluationIds.sort((left, right) => left - right);
  return {
    representatives,
    duplicateEvaluationIds,
  };
}

function rankPerLanguage(
  submissions: RankedSubmissionCandidate[],
  forcedBest: Record<string, number>,
  comparer: (
    left: RankedSubmissionCandidate,
    right: RankedSubmissionCandidate,
    forcedBest: Record<string, number>,
  ) => number,
): {
  ids: Record<string, number>;
  candidates: Record<string, RankedSubmissionCandidate>;
} {
  const buckets = new Map<string, RankedSubmissionCandidate[]>();
  for (const submission of submissions) {
    const bucket = buckets.get(submission.normalizedLanguage) ?? [];
    bucket.push(submission);
    buckets.set(submission.normalizedLanguage, bucket);
  }

  const ids: Record<string, number> = {};
  const candidates: Record<string, RankedSubmissionCandidate> = {};
  for (const [language, bucket] of buckets) {
    const best = [...bucket].sort((left, right) => comparer(left, right, forcedBest))[0];
    /* v8 ignore next 3 -- each bucket holds at least one candidate, so [0] is always defined */
    if (!best) {
      continue;
    }
    ids[language] = best.evaluationId;
    candidates[language] = best;
  }

  return {
    ids,
    candidates,
  };
}

function compareTrustworthyCandidates(
  left: RankedSubmissionCandidate,
  right: RankedSubmissionCandidate,
  forcedBest: Record<string, number>,
): number {
  const leftScore = candidateScore(left, forcedBest[left.normalizedLanguage], true);
  const rightScore = candidateScore(right, forcedBest[right.normalizedLanguage], true);
  return compareScoreVectors(leftScore, rightScore, left.evaluationId, right.evaluationId);
}

function compareFastCandidates(
  left: RankedSubmissionCandidate,
  right: RankedSubmissionCandidate,
  forcedBest: Record<string, number>,
): number {
  const leftScore = candidateScore(left, forcedBest[left.normalizedLanguage], false);
  const rightScore = candidateScore(right, forcedBest[right.normalizedLanguage], false);
  return compareScoreVectors(leftScore, rightScore, left.evaluationId, right.evaluationId);
}

function candidateScore(
  submission: SubmissionRecord | RankedSubmissionCandidate,
  forcedEvaluationId: number | undefined,
  prioritizeTrustworthiness: boolean,
): number[] {
  const forcedBoost =
    forcedEvaluationId !== undefined &&
    submission.evaluationId === forcedEvaluationId
      ? 1
      : 0;
  const trustworthyBoost = getEffectiveSuspicionFlags(submission).length === 0 ? 1 : 0;
  const acceptedScore = submission.score >= 100 ? 1 : 0;
  const runtimeRank =
    submission.runtimeSeconds !== undefined
      ? -submission.runtimeSeconds
      : Number.NEGATIVE_INFINITY;
  const memoryRank =
    submission.memoryKb !== undefined
      ? -submission.memoryKb
      : Number.NEGATIVE_INFINITY;
  const recencyRank = Date.parse(submission.fetchedAt) || 0;

  if (!prioritizeTrustworthiness) {
    return [
      forcedBoost,
      acceptedScore,
      submission.score,
      runtimeRank,
      memoryRank,
      trustworthyBoost,
      submission.sourceAvailable ? 1 : 0,
      recencyRank,
    ];
  }

  return [
    forcedBoost,
    trustworthyBoost,
    acceptedScore,
    submission.score,
    submission.sourceAvailable ? 1 : 0,
    runtimeRank,
    memoryRank,
    recencyRank,
  ];
}

function compareScoreVectors(
  left: number[],
  right: number[],
  leftEvaluationId: number,
  rightEvaluationId: number,
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return right[index]! - left[index]!;
    }
  }

  return rightEvaluationId - leftEvaluationId;
}

function rankOfficialSources(
  sources: SourceRecord[],
): Record<string, string> {
  const bestOfficialPerLanguage: Record<string, string> = {};
  const buckets = new Map<string, SourceRecord[]>();
  for (const source of sources) {
    if (!isCoverageSatisfyingOfficialSource(source)) {
      continue;
    }

    const language = normalizeLanguage(source.language) ?? source.language;
    const bucket = buckets.get(language) ?? [];
    bucket.push(source);
    buckets.set(language, bucket);
  }

  for (const [language, bucket] of buckets) {
    const best = [...bucket].sort(compareOfficialSources)[0];
    if (best) {
      bestOfficialPerLanguage[language] = best.sourceId;
    }
  }

  return bestOfficialPerLanguage;
}

function compareOfficialSources(left: SourceRecord, right: SourceRecord): number {
  const leftScore = scoreOfficialSource(left);
  const rightScore = scoreOfficialSource(right);

  for (let index = 0; index < leftScore.length; index += 1) {
    if (leftScore[index] !== rightScore[index]) {
      return rightScore[index]! - leftScore[index]!;
    }
  }

  return left.sourceId.localeCompare(right.sourceId);
}

function scoreOfficialSource(source: SourceRecord): number[] {
  return [
    /* v8 ignore next -- rankOfficialSources only scores sources already filtered to score >= 100 */
    source.score !== undefined && source.score >= 100 ? 1 : 0,
    /* v8 ignore next -- rankOfficialSources only scores sources already filtered to sourceAvailable */
    source.sourceAvailable ? 1 : 0,
    getEffectiveSuspicionFlags(source).length === 0 ? 1 : 0,
    source.sourceLength ?? source.sourceCode?.length ?? 0,
  ];
}

function isTrustworthyCandidate(candidate: RankedSubmissionCandidate): boolean {
  return candidate.effectiveSuspicionFlags.length === 0
    && candidate.score >= 100
    && candidate.sourceAvailable;
}

function isCoverageSatisfyingOfficialSource(source: SourceRecord): boolean {
  return source.kind === 'official'
    && source.sourceAvailable
    && source.score !== undefined
    && source.score >= 100
    && source.provenanceType !== 'official-fragment';
}

function getEffectiveSuspicionFlags(
  submission: Pick<SubmissionRecord, 'sourceCode' | 'suspicionFlags'> | RankedSubmissionCandidate | SourceRecord,
): string[] {
  if ('effectiveSuspicionFlags' in submission) {
    return submission.effectiveSuspicionFlags;
  }

  return normalizeBlockingSuspicionFlags(
    submission.sourceCode
      ? detectSuspicionFlags(submission.sourceCode)
      : submission.suspicionFlags,
    submission.sourceCode,
  );
}

function normalizeBlockingSuspicionFlags(
  flags: string[] | undefined,
  sourceCode: string | undefined,
): string[] {
  const uniqueFlags = [...new Set(flags ?? [])];
  const weakOnlyFlags = new Set(['tiny-source', 'constant-output', 'lookup-table']);
  if (uniqueFlags.length > 0 && uniqueFlags.every((flag) => weakOnlyFlags.has(flag))) {
    return [];
  }

  const normalizedSource = sourceCode?.toLowerCase() ?? '';
  const compactLength = normalizedSource.replace(/\s+/g, ' ').trim().length;
  const relaxedBranchingOnly =
    uniqueFlags.length > 0
    && uniqueFlags.every((flag) => flag === 'input-branching')
    && compactLength >= 180;
  const relaxedBranchingAndLiteralPairs =
    uniqueFlags.length > 0
    && uniqueFlags.every((flag) => flag === 'input-branching' || flag === 'literal-pairs')
    && compactLength >= 180;
  if (relaxedBranchingOnly || relaxedBranchingAndLiteralPairs) {
    return [];
  }

  return uniqueFlags;
}
