import { describe, expect, test } from 'vitest';

import { rankProblemSubmissions } from '../../src/ranking/rank-submissions.js';
import type { SourceRecord, SubmissionRecord } from '../../src/types/records.js';

function submission(overrides: Partial<SubmissionRecord>): SubmissionRecord {
  return {
    evaluationId: 1,
    problemId: 3253,
    problemSlug: 'par-impar3',
    language: 'cpp',
    user: 'Prekzursil',
    score: 100,
    verdictSummary: 'OK.',
    runtimeSeconds: 0.01,
    memoryKb: 256,
    sourceAvailable: true,
    sourceCode: 'int main() { return 0; }',
    suspicionFlags: [],
    tests: [],
    fetchedAt: '2026-03-10T00:00:00.000Z',
    provenance: ['user-solutions'],
    ...overrides,
  };
}

describe('rankProblemSubmissions', () => {
  test('prefers clean 100-point submissions over suspicious faster ones', () => {
    const ranked = rankProblemSubmissions([
      submission({ evaluationId: 10, language: 'cpp', runtimeSeconds: 0.015 }),
      submission({
        evaluationId: 11,
        language: 'cpp',
        runtimeSeconds: 0.001,
        sourceCode: 'int main(){int n;cin>>n;if(n==1)return 0;cout<<42;}',
        suspicionFlags: ['constant-output'],
      }),
      submission({
        evaluationId: 12,
        language: 'py',
        score: 80,
        verdictSummary: 'Time limit exceeded',
        runtimeSeconds: 1.9,
      }),
    ]);

    expect(ranked.bestUserOverallEvaluationId).toBe(10);
    expect(ranked.bestTrustworthyOverallEvaluationId).toBe(10);
    expect(ranked.bestUserPerLanguage).toEqual({
      cpp: 10,
      py: 12,
    });
    expect(ranked.bestTrustworthyPerLanguage).toEqual({
      cpp: 10,
      py: 12,
    });
    expect(ranked.bestFastPerLanguage).toEqual({
      cpp: 11,
      py: 12,
    });
    expect(ranked.suspiciousCandidateEvaluationIds).toEqual([11]);
    expect(ranked.bestOfficialPerLanguage).toEqual({});
  });

  test('deduplicates repeated submissions of the same source per language and still honors overrides', () => {
    const ranked = rankProblemSubmissions(
      [
        submission({
          evaluationId: 20,
          language: 'cpp',
          runtimeSeconds: 0.012,
          fetchedAt: '2026-03-01T00:00:00.000Z',
          sourceCode: 'int main(){return 0;}',
        }),
        submission({
          evaluationId: 21,
          language: 'cpp',
          runtimeSeconds: 0.012,
          fetchedAt: '2026-03-03T00:00:00.000Z',
          sourceCode: 'int main(){return 0;}',
        }),
        submission({
          evaluationId: 22,
          language: 'cpp',
          runtimeSeconds: 0.011,
          fetchedAt: '2026-03-02T00:00:00.000Z',
          sourceCode: 'int main(){int x=1;return x;}',
        }),
      ],
      [],
      {
        forcedBestEvaluationIds: {
          cpp: 21,
        },
      },
    );

    expect(ranked.bestUserOverallEvaluationId).toBe(21);
    expect(ranked.bestUserPerLanguage.cpp).toBe(21);
    expect(ranked.duplicateEvaluationIds).toEqual([20]);
    expect(ranked.orderedUserEvaluationIds.slice(0, 2)).toEqual([21, 22]);
  });

  test('tracks best official source per language separately from user evaluations', () => {
    const officialSources: SourceRecord[] = [
      {
        sourceId: 'official-3253-cpp',
        kind: 'official',
        problemId: 3253,
        language: 'cpp',
        sourceAvailable: true,
        sourceCode: 'int main() { return 0; }',
        suspicionFlags: [],
        provenance: ['official'],
      },
      {
        sourceId: 'official-3253-py',
        kind: 'official',
        problemId: 3253,
        language: 'py',
        sourceAvailable: true,
        sourceCode: 'print(42)',
        suspicionFlags: [],
        provenance: ['official'],
      },
    ];

    const ranked = rankProblemSubmissions(
      [submission({ evaluationId: 30, language: 'cpp' })],
      officialSources,
    );

    expect(ranked.bestUserPerLanguage).toEqual({ cpp: 30 });
    expect(ranked.bestOfficialPerLanguage).toEqual({
      cpp: 'official-3253-cpp',
      py: 'official-3253-py',
    });
  });
});
