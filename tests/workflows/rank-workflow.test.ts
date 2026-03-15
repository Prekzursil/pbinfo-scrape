import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { runRankingWorkflow } from '../../src/workflows/rank-workflow.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('runRankingWorkflow', () => {
  test('loads evaluation records and writes best-submission summaries', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-ranking-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-2026-03-10',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const evaluationsRoot = join(snapshot.normalizedRoot, 'evaluations');
    const sourcesRoot = join(snapshot.normalizedRoot, 'sources');
    mkdirSync(evaluationsRoot, { recursive: true });
    mkdirSync(sourcesRoot, { recursive: true });

    writeFileSync(
      join(evaluationsRoot, '3253-10.json'),
      JSON.stringify({
        evaluationId: 10,
        problemId: 3253,
        problemName: 'par_impar3',
        problemSlug: 'par-impar3',
        language: 'cpp',
        user: 'Prekzursil',
        score: 100,
        verdictSummary: 'OK.',
        runtimeSeconds: 0.015,
        memoryKb: 256,
        sourceAvailable: true,
        sourceCode: 'int main() { return 0; }',
        suspicionFlags: [],
        tests: [],
        fetchedAt: '2026-03-10T00:00:00.000Z',
        provenance: ['user-solutions']
      }),
      'utf8',
    );

    writeFileSync(
      join(evaluationsRoot, '3253-11.json'),
      JSON.stringify({
        evaluationId: 11,
        problemId: 3253,
        problemName: 'par_impar3',
        problemSlug: 'par-impar3',
        language: 'py',
        user: 'Prekzursil',
        score: 80,
        verdictSummary: 'Time limit exceeded',
        runtimeSeconds: 1.9,
        memoryKb: 1024,
        sourceAvailable: true,
        sourceCode: 'print(11)',
        suspicionFlags: [],
        tests: [],
        fetchedAt: '2026-03-10T00:00:00.000Z',
        provenance: ['user-solutions']
      }),
      'utf8',
    );

    writeFileSync(
      join(sourcesRoot, 'official-3253-cpp.json'),
      JSON.stringify({
        sourceId: 'official-3253-cpp',
        kind: 'official',
        problemId: 3253,
        language: 'cpp',
        sourceAvailable: true,
        sourceCode: 'int main() { return 0; }',
        suspicionFlags: [],
        provenance: ['official'],
      }),
      'utf8',
    );

    const result = await runRankingWorkflow(workspaceRoot);
    const summary = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'rankings', 'best-submissions.json'), 'utf8'),
    );

    expect(result.problemsRanked).toBe(1);
    expect(summary).toEqual({
      generatedAt: expect.any(String),
      problems: [
        {
          problemId: 3253,
          bestUserOverallEvaluationId: 10,
          bestUserPerLanguage: {
            cpp: 10,
            py: 11,
          },
          bestTrustworthyOverallEvaluationId: 10,
          bestTrustworthyPerLanguage: {
            cpp: 10,
            py: 11,
          },
          bestFastPerLanguage: {
            cpp: 10,
            py: 11,
          },
          bestOfficialPerLanguage: {
            cpp: 'official-3253-cpp',
          },
          suspiciousCandidateEvaluationIds: [],
          duplicateEvaluationIds: [],
          orderedUserEvaluationIds: [10, 11],
        },
      ],
    });
  });
});
