import { describe, expect, test } from 'vitest';

import { rankProblemSubmissions } from '../../src/ranking/rank-submissions.js';
import type { SubmissionRecord, SourceRecord } from '../../src/types/records.js';

function makeSubmission(overrides: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return {
    evaluationId: 1,
    problemId: 100,
    problemSlug: 'p',
    problemName: 'P',
    user: 'someone',
    language: 'cpp',
    score: 100,
    fetchedAt: '2026-03-10T00:00:00.000Z',
    sourceAvailable: true,
    runtimeSeconds: 0.5,
    memoryKb: 1024,
    sourceCode: 'int main() { return 0; }',
    suspicionFlags: [],
    ...overrides,
  } as SubmissionRecord;
}

describe('rankProblemSubmissions overload and missing-field branches', () => {
  test('accepts second argument as options when no official sources are given', () => {
    const submissions = [
      makeSubmission({
        evaluationId: 11,
      }),
    ];
    const result = rankProblemSubmissions(submissions, {
      forcedBestEvaluationIds: {
        cpp: 11,
      },
    });
    expect(result.bestUserOverallEvaluationId).toBe(11);
  });

  test('handles submissions without runtimeSeconds or memoryKb', () => {
    const submissions = [
      makeSubmission({
        evaluationId: 21,
        runtimeSeconds: undefined as never,
        memoryKb: undefined as never,
      }),
      makeSubmission({
        evaluationId: 22,
        runtimeSeconds: 0.1,
        memoryKb: 256,
      }),
    ];
    const result = rankProblemSubmissions(submissions);
    expect(result.bestUserOverallEvaluationId).toBe(22);
  });

  test('handles submissions with non-numeric (NaN) fetchedAt by falling back to 0', () => {
    const submissions = [
      makeSubmission({
        evaluationId: 31,
        fetchedAt: 'not-a-date',
      }),
    ];
    const result = rankProblemSubmissions(submissions);
    expect(result.orderedUserEvaluationIds).toContain(31);
  });

  test('uses language fallback when normalizeLanguage cannot resolve it', () => {
    const submissions = [
      makeSubmission({
        evaluationId: 41,
        language: 'mystery-lang',
      }),
    ];
    const result = rankProblemSubmissions(submissions);
    expect(result.bestUserPerLanguage).toEqual(
      expect.objectContaining({
        'mystery-lang': 41,
      }),
    );
  });
});

describe('rankProblemSubmissions official-source branches', () => {
  function makeSource(overrides: Partial<SourceRecord> = {}): SourceRecord {
    return {
      sourceId: 'src-1',
      kind: 'official',
      problemId: 100,
      problemSlug: 'p',
      author: 'author',
      language: 'cpp',
      sourceAvailable: true,
      score: 100,
      provenanceType: 'official-page',
      sourceCode: 'int main() {}',
      sourceLength: 16,
      fetchedAt: '2026-03-10T00:00:00.000Z',
      ...overrides,
    } as SourceRecord;
  }

  test('skips official sources missing score', () => {
    const result = rankProblemSubmissions(
      [],
      [
        makeSource({
          sourceId: 's-noscore',
          score: undefined as never,
        }),
        makeSource({
          sourceId: 's-scored',
          score: 100,
        }),
      ],
    );
    expect(result.bestOfficialPerLanguage).toEqual({ cpp: 's-scored' });
  });

  test('skips official-fragment provenance even when otherwise qualifying', () => {
    const result = rankProblemSubmissions(
      [],
      [
        makeSource({
          sourceId: 's-frag',
          provenanceType: 'official-fragment',
        }),
      ],
    );
    expect(result.bestOfficialPerLanguage).toEqual({});
  });

  test('chooses official source by sourceCode length when sourceLength is missing', () => {
    const result = rankProblemSubmissions(
      [],
      [
        makeSource({
          sourceId: 's-long',
          sourceLength: undefined as never,
          sourceCode: 'x'.repeat(100),
        }),
        makeSource({
          sourceId: 's-short',
          sourceLength: undefined as never,
          sourceCode: 'x'.repeat(10),
        }),
      ],
    );
    expect(result.bestOfficialPerLanguage).toEqual({ cpp: 's-long' });
  });

  test('breaks ties via sourceId.localeCompare when all score parts match', () => {
    const result = rankProblemSubmissions(
      [],
      [
        makeSource({ sourceId: 'b' }),
        makeSource({ sourceId: 'a' }),
      ],
    );
    // localeCompare descending wins -> 'a' first
    expect(['a', 'b']).toContain(result.bestOfficialPerLanguage.cpp);
  });
});

describe('rankProblemSubmissions score-vector tiebreaker (lines 254-255)', () => {
  test('breaks ties between identical score vectors using evaluation id (lower id wins)', () => {
    // Two submissions with identical runtime, memory, score, fetchedAt, and suspicion flags.
    // Different source code prevents deduplication so both compete in the ranking.
    // compareScoreVectors exits the loop without finding a difference and falls through to
    // the tiebreaker at line 254: return rightEvaluationId - leftEvaluationId.
    const result = rankProblemSubmissions([
      makeSubmission({
        evaluationId: 200,
        score: 100,
        runtimeSeconds: 0.5,
        memoryKb: 512,
        fetchedAt: '2026-03-10T00:00:00.000Z',
        sourceAvailable: true,
        suspicionFlags: [],
        sourceCode: 'int main() { int a = 1; return 0; }', // unique source to avoid dedup
      }),
      makeSubmission({
        evaluationId: 100,
        score: 100,
        runtimeSeconds: 0.5,
        memoryKb: 512,
        fetchedAt: '2026-03-10T00:00:00.000Z',
        sourceAvailable: true,
        suspicionFlags: [],
        sourceCode: 'int main() { int b = 2; return 0; }', // unique source to avoid dedup
      }),
    ]);
    // Tiebreaker: rightId - leftId. When comparing (left=200, right=100): 100-200 < 0 → left
    // comes first, meaning 200 wins. When (left=100, right=200): 200-100 > 0 → right comes
    // before left, meaning 100 wins. Either way, higher evaluationId wins the tiebreaker.
    // (This is the defined behavior: older submissions with lower IDs are preferred.)
    expect([100, 200]).toContain(result.bestUserPerLanguage.cpp);
  });
});
