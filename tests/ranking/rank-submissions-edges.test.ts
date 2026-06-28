import { describe, expect, test } from 'vitest';

import { rankProblemSubmissions } from '../../src/ranking/rank-submissions.js';
import type { SourceRecord, SubmissionRecord } from '../../src/types/records.js';

function sub(overrides: Partial<SubmissionRecord> & { evaluationId: number }): SubmissionRecord {
  return {
    problemId: 1,
    problemSlug: 'p',
    language: 'cpp',
    user: 'alice',
    score: 100,
    verdictSummary: 'Accepted',
    sourceAvailable: true,
    suspicionFlags: [],
    tests: [],
    fetchedAt: '2026-01-01T00:00:00.000Z',
    provenance: [],
    ...overrides,
  };
}

function source(overrides: Partial<SourceRecord> & { sourceId: string }): SourceRecord {
  return {
    kind: 'official',
    problemId: 1,
    language: 'cpp',
    sourceAvailable: true,
    score: 100,
    suspicionFlags: [],
    provenance: [],
    ...overrides,
  };
}

describe('rankProblemSubmissions edges', () => {
  test('accepts ranking options as the second argument', () => {
    const result = rankProblemSubmissions([sub({ evaluationId: 1 }), sub({ evaluationId: 2 })], {
      forcedBestEvaluationIds: { cpp: 2 },
    });
    expect(result.bestUserPerLanguage.cpp).toBe(2);
  });

  test('keeps an unrecognized language label as-is', () => {
    const result = rankProblemSubmissions([sub({ evaluationId: 5, language: 'klingon', sourceCode: 'x' })]);
    expect(result.bestUserPerLanguage.klingon).toBe(5);
  });

  test('handles missing runtime/memory, invalid timestamps, and unavailable sources', () => {
    const result = rankProblemSubmissions([
      sub({ evaluationId: 1, runtimeSeconds: undefined, memoryKb: undefined, fetchedAt: 'not-a-date', sourceAvailable: false, score: 50 }),
      sub({ evaluationId: 2, runtimeSeconds: 1, memoryKb: 100, score: 100 }),
    ]);
    expect(result.bestUserOverallEvaluationId).toBe(2);
  });

  test('breaks ties between identical candidates by evaluation id', () => {
    // Distinct source code -> two representatives with identical score vectors,
    // so the comparison falls through to the evaluation-id tie-break.
    const result = rankProblemSubmissions([
      sub({ evaluationId: 10, sourceCode: 'aaa' }),
      sub({ evaluationId: 20, sourceCode: 'bbb' }),
    ]);
    expect(result.orderedUserEvaluationIds).toEqual([20, 10]);
  });

  test('ranks official sources, skipping fragments and unavailable bodies', () => {
    const sources: SourceRecord[] = [
      source({ sourceId: 'off-cpp-a', sourceCode: 'int main(){return 0;}' }),
      source({ sourceId: 'off-cpp-b', sourceLength: 5 }),
      source({ sourceId: 'off-frag', provenanceType: 'official-fragment' }),
      source({ sourceId: 'off-unavailable', sourceAvailable: false }),
      source({ sourceId: 'off-py', language: 'klingon', sourceCode: 'print(1)' }),
    ];
    const result = rankProblemSubmissions([sub({ evaluationId: 1 })], sources);
    expect(result.bestOfficialPerLanguage.cpp).toBeDefined();
    expect(result.bestOfficialPerLanguage.klingon).toBe('off-py');
  });

  test('treats sources with undefined suspicion flags safely', () => {
    const sources: SourceRecord[] = [
      source({ sourceId: 's1', suspicionFlags: undefined as unknown as string[] }),
    ];
    const result = rankProblemSubmissions([], sources);
    expect(result.bestOfficialPerLanguage.cpp).toBe('s1');
  });

  test('falls back to the fastest candidate when none are trustworthy', () => {
    const result = rankProblemSubmissions([
      sub({ evaluationId: 1, score: 50 }),
      sub({ evaluationId: 2, score: 40 }),
    ]);
    expect(result.bestTrustworthyOverallEvaluationId).toBeUndefined();
    expect(result.bestUserOverallEvaluationId).toBe(1);
  });

  test('keeps an empty language label for submissions and official sources', () => {
    const result = rankProblemSubmissions([sub({ evaluationId: 3, language: '' })], [
      source({ sourceId: 'off-empty', language: '' }),
    ]);
    expect(result.bestUserPerLanguage['']).toBe(3);
    expect(result.bestOfficialPerLanguage['']).toBe('off-empty');
  });

  test('breaks official-source ties by id and scores length variants', () => {
    const sources: SourceRecord[] = [
      source({ sourceId: 'off-z', sourceLength: 10 }),
      source({ sourceId: 'off-a', sourceLength: 10 }),
      source({ sourceId: 'off-code', sourceCode: 'code', sourceLength: undefined }),
      source({ sourceId: 'off-none', sourceLength: undefined }),
      source({ sourceId: 'off-flagged', sourceCode: 'int main(){int n;cin>>n;if(n==11)cout<<1;if(n==22)cout<<2;if(n==33)cout<<3;}', sourceLength: undefined }),
      source({ sourceId: 'off-noflags', sourceLength: 1, suspicionFlags: undefined as unknown as string[] }),
    ];
    const result = rankProblemSubmissions([], sources);
    // off-a and off-z tie on score vector; localeCompare picks off-a.
    expect(result.bestOfficialPerLanguage.cpp).toBe('off-a');
  });

  test('drops weak-only suspicion flags so the candidate stays trustworthy', () => {
    const result = rankProblemSubmissions([sub({ evaluationId: 9, sourceCode: 'cout<<42;' })]);
    expect(result.bestTrustworthyOverallEvaluationId).toBe(9);
  });

  test('relaxes combined branching and literal-pairs flags for longer sources', () => {
    const padding =
      '/* padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding more */';
    const code = `int main(){int n;cin>>n;${padding}if(n==11)cout<<111;if(n==22)cout<<222;if(n==33)cout<<333;}`;
    const result = rankProblemSubmissions([sub({ evaluationId: 7, sourceCode: code })]);
    // Relaxed flags mean the candidate is still trustworthy and ranked.
    expect(result.bestTrustworthyOverallEvaluationId).toBe(7);
  });
});
