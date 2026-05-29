import { describe, expect, test } from 'vitest';

import { rankProblemSubmissions } from '../../src/ranking/rank-submissions.js';
import type { SourceRecord, SubmissionRecord } from '../../src/types/records.js';

function makeSource(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    sourceId: 'official-1-cpp',
    kind: 'official',
    problemId: 1,
    language: 'cpp',
    sourceAvailable: true,
    sourceCode: 'int main(){return 0;}',
    sourceLength: 'int main(){return 0;}'.length,
    score: 100,
    suspicionFlags: [],
    fetchedAt: '2026-03-10T00:00:00.000Z',
    provenance: ['official-solution'],
    ...overrides,
  };
}

function makeSubmission(overrides: Partial<SubmissionRecord>): SubmissionRecord {
  return {
    evaluationId: 1,
    problemId: 1,
    problemSlug: 'p',
    language: 'cpp',
    user: 'someone',
    score: 100,
    verdictSummary: 'OK.',
    runtimeSeconds: 0.01,
    memoryKb: 256,
    sourceAvailable: true,
    sourceCode: '#include <iostream>\nint main(){return 0;}',
    suspicionFlags: [],
    tests: [],
    fetchedAt: '2026-03-10T00:00:00.000Z',
    provenance: ['user-solutions'],
    ...overrides,
  };
}

describe('rankProblemSubmissions official source ranking', () => {
  test('picks the longest qualifying official source per language and skips unqualified ones', () => {
    const ranked = rankProblemSubmissions(
      [makeSubmission({ evaluationId: 100 })],
      [
        makeSource({
          sourceId: 'official-1-cpp-a',
          language: 'cpp',
          sourceCode: 'int main(){return 0;}',
          sourceLength: 22,
        }),
        makeSource({
          sourceId: 'official-1-cpp-b',
          language: 'cpp',
          sourceCode: 'int main(){int n=0;return n;}',
          sourceLength: 30,
        }),
        // Below-100 source: filtered out by isCoverageSatisfyingOfficialSource.
        makeSource({
          sourceId: 'official-1-c-unscored',
          language: 'c',
          score: 50,
        }),
        // Fragment-only source: filtered out by provenanceType guard.
        makeSource({
          sourceId: 'official-1-c-fragment',
          language: 'c',
          provenanceType: 'official-fragment',
        }),
        // Python source: kept (it has 100 + source).
        makeSource({
          sourceId: 'official-1-py',
          language: 'py',
          sourceCode: 'print(1)',
          sourceLength: 8,
        }),
      ],
    );
    expect(ranked.bestOfficialPerLanguage.cpp).toBe('official-1-cpp-b');
    expect(ranked.bestOfficialPerLanguage.py).toBe('official-1-py');
    expect(ranked.bestOfficialPerLanguage.c).toBeUndefined();
  });

  test('breaks ties by sourceId localeCompare when score vectors match exactly', () => {
    const ranked = rankProblemSubmissions(
      [],
      [
        makeSource({
          sourceId: 'official-2-cpp-z',
          language: 'cpp',
          sourceCode: 'int main(){return 0;}',
          sourceLength: 10,
        }),
        makeSource({
          sourceId: 'official-2-cpp-a',
          language: 'cpp',
          sourceCode: 'int main(){return 0;}',
          sourceLength: 10,
        }),
      ],
    );
    expect(ranked.bestOfficialPerLanguage.cpp).toBe('official-2-cpp-a');
  });
});
