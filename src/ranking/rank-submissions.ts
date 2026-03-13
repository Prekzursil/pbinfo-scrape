import type {
  RankedProblemSubmissions,
  SourceRecord,
  SubmissionRecord,
} from '../types/records.js';

export interface RankingOptions {
  forcedBestEvaluationIds?: Record<string, number>;
}

function scoreCandidate(
  submission: SubmissionRecord,
  forcedEvaluationId?: number,
  mode: 'language' | 'overall' = 'language',
): number[] {
  const forcedBoost =
    forcedEvaluationId !== undefined &&
    submission.evaluationId === forcedEvaluationId
      ? 1
      : 0;
  const acceptedScore = submission.score >= 100 ? 1 : 0;
  const suspiciousPenalty = submission.suspicionFlags.length > 0 ? 0 : 1;
  const runtimeRank =
    submission.runtimeSeconds !== undefined
      ? -submission.runtimeSeconds
      : Number.NEGATIVE_INFINITY;
  const memoryRank =
    submission.memoryKb !== undefined
      ? -submission.memoryKb
      : Number.NEGATIVE_INFINITY;
  const recencyRank = Date.parse(submission.fetchedAt) || 0;

  return [
    forcedBoost,
    acceptedScore,
    submission.score,
    suspiciousPenalty,
    ...(mode === 'language' ? [runtimeRank, memoryRank] : []),
    recencyRank,
    submission.evaluationId,
  ];
}

function compareSubmissions(
  left: SubmissionRecord,
  right: SubmissionRecord,
  forcedEvaluationId?: number,
  mode: 'language' | 'overall' = 'language',
): number {
  const leftScore = scoreCandidate(left, forcedEvaluationId, mode);
  const rightScore = scoreCandidate(right, forcedEvaluationId, mode);

  for (let index = 0; index < leftScore.length; index += 1) {
    if (leftScore[index] !== rightScore[index]) {
      return rightScore[index]! - leftScore[index]!;
    }
  }

  return 0;
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
  const bestUserPerLanguage: Record<string, number> = {};
  const bestCandidates: SubmissionRecord[] = [];
  const ordered = [...submissions].sort((left, right) =>
    compareSubmissions(left, right, forcedBest[left.language], 'language'),
  );

  const languageBuckets = new Map<string, SubmissionRecord[]>();
  for (const submission of submissions) {
    const bucket = languageBuckets.get(submission.language) ?? [];
    bucket.push(submission);
    languageBuckets.set(submission.language, bucket);
  }

  for (const [language, bucket] of languageBuckets) {
    const rankedBucket = [...bucket].sort((left, right) =>
      compareSubmissions(left, right, forcedBest[language], 'language'),
    );
    const best = rankedBucket[0];
    if (best) {
      bestUserPerLanguage[language] = best.evaluationId;
      bestCandidates.push(best);
    }
  }

  const bestUserOverall = [...bestCandidates].sort((left, right) => {
    const forcedLeft = forcedBest[left.language];
    const forcedRight = forcedBest[right.language];
    const forcedId =
      forcedLeft !== undefined && forcedLeft === left.evaluationId
        ? forcedLeft
        : forcedRight;
    return compareSubmissions(left, right, forcedId, 'overall');
  })[0];

  const bestOfficialPerLanguage = rankOfficialSources(officialSources);

  return {
    bestUserOverallEvaluationId: bestUserOverall?.evaluationId,
    bestUserPerLanguage,
    bestOfficialPerLanguage,
    orderedUserEvaluationIds: ordered.map((submission) => submission.evaluationId),
  };
}

function rankOfficialSources(
  sources: SourceRecord[],
): Record<string, string> {
  const bestOfficialPerLanguage: Record<string, string> = {};
  const buckets = new Map<string, SourceRecord[]>();
  for (const source of sources) {
    if (source.kind !== 'official') {
      continue;
    }

    const bucket = buckets.get(source.language) ?? [];
    bucket.push(source);
    buckets.set(source.language, bucket);
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
    source.sourceAvailable ? 1 : 0,
    source.suspicionFlags.length === 0 ? 1 : 0,
    source.sourceCode?.length ?? 0,
  ];
}
