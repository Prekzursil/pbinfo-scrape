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
        sourceCode: [
          '#include <iostream>',
          'using namespace std;',
          'int main() {',
          '  int n;',
          '  cin >> n;',
          '  cout << (n % 2);',
          '  return 0;',
          '}',
        ].join('\n'),
        suspicionFlags: [],
        tests: [],
        fetchedAt: '2026-03-10T00:00:00.000Z',
        provenance: ['user-solutions'],
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
        provenance: ['user-solutions'],
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
        score: 100,
        sourceAvailable: true,
        sourceCode: [
          '#include <iostream>',
          'using namespace std;',
          'int main() {',
          '  int n;',
          '  cin >> n;',
          '  cout << (n % 2);',
          '  return 0;',
          '}',
        ].join('\n'),
        suspicionFlags: [],
        provenanceType: 'official-evaluation',
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

  test('recomputes suspicion flags from source code so stale archived flags do not poison trustworthy ranking', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-ranking-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-2026-03-18',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });
    const evaluationsRoot = join(snapshot.normalizedRoot, 'evaluations');
    mkdirSync(evaluationsRoot, { recursive: true });

    writeFileSync(
      join(evaluationsRoot, '45-7426854.json'),
      JSON.stringify({
        evaluationId: 7426854,
        problemId: 45,
        problemName: 'prim',
        problemSlug: 'prim',
        language: 'cpp',
        user: 'Prekzursil',
        score: 100,
        verdictSummary: 'OK.',
        runtimeSeconds: 0.1,
        memoryKb: 256,
        sourceAvailable: true,
        sourceCode: [
          '#include <iostream>',
          '#include <cmath>',
          'using namespace std;',
          'int main() {',
          '  int n;',
          '  cin >> n;',
          '  int ok = 1;',
          '  for (int d = 2; d <= sqrt(n) && ok == 1; d++)',
          '    if (n % d == 0) ok = 0;',
          '  if (ok == 1 && n > 1) cout << "DA";',
          '  else cout << "NU";',
          '  return 0;',
          '}',
        ].join('\n'),
        suspicionFlags: ['input-branching'],
        tests: [],
        fetchedAt: '2026-03-18T00:00:00.000Z',
        provenance: ['user-solutions'],
      }),
      'utf8',
    );

    await runRankingWorkflow(workspaceRoot);
    const summary = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'rankings', 'best-submissions.json'), 'utf8'),
    );

    expect(summary).toEqual({
      generatedAt: expect.any(String),
      problems: [
        {
          problemId: 45,
          bestUserOverallEvaluationId: 7426854,
          bestUserPerLanguage: {
            cpp: 7426854,
          },
          bestTrustworthyOverallEvaluationId: 7426854,
          bestTrustworthyPerLanguage: {
            cpp: 7426854,
          },
          bestFastPerLanguage: {
            cpp: 7426854,
          },
          bestOfficialPerLanguage: {},
          suspiciousCandidateEvaluationIds: [],
          duplicateEvaluationIds: [],
          orderedUserEvaluationIds: [7426854],
        },
      ],
    });
  });

  test('filters ranking inputs to the configured handle so foreign faster submissions do not fill best-user slots', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-ranking-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify({
        crawl: {
          userHandle: 'Prekzursil',
        },
      }),
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-2026-03-18-user-filter',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });
    const evaluationsRoot = join(snapshot.normalizedRoot, 'evaluations');
    mkdirSync(evaluationsRoot, { recursive: true });

    writeFileSync(
      join(evaluationsRoot, '54-15188.json'),
      JSON.stringify({
        evaluationId: 15188,
        problemId: 54,
        problemName: 'maxim',
        problemSlug: 'maxim',
        language: 'cpp',
        user: 'Candale Silviu (silviu)',
        score: 100,
        verdictSummary: '100 puncte',
        runtimeSeconds: 0.1,
        memoryKb: 64,
        sourceAvailable: false,
        suspicionFlags: [],
        tests: [],
        fetchedAt: '2026-03-18T00:00:00.000Z',
        provenance: ['evaluation-detail'],
      }),
      'utf8',
    );

    writeFileSync(
      join(evaluationsRoot, '54-7644260.json'),
      JSON.stringify({
        evaluationId: 7644260,
        problemId: 54,
        problemName: 'maxim',
        problemSlug: 'maxim',
        language: 'cpp',
        user: 'Andrei Visalon (Prekzursil)',
        score: 100,
        verdictSummary: '100 puncte',
        runtimeSeconds: 0.1,
        memoryKb: 64,
        sourceAvailable: true,
        sourceCode: [
          '#include <iostream>',
          '#include <climits>',
          'using namespace std;',
          'int main() {',
          '  int n, maxValue = INT_MIN;',
          '  while (cin >> n && n != 0) {',
          '    if (n > maxValue) maxValue = n;',
          '  }',
          '  if (maxValue < 0) cout << "NU EXISTA";',
          '  else cout << maxValue;',
          '  return 0;',
          '}',
        ].join('\n'),
        suspicionFlags: [],
        tests: [],
        fetchedAt: '2026-03-18T00:00:01.000Z',
        provenance: ['evaluation-detail'],
      }),
      'utf8',
    );

    await runRankingWorkflow(workspaceRoot);
    const summary = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'rankings', 'best-submissions.json'), 'utf8'),
    );

    expect(summary).toEqual({
      generatedAt: expect.any(String),
      problems: [
        {
          problemId: 54,
          bestUserOverallEvaluationId: 7644260,
          bestUserPerLanguage: {
            cpp: 7644260,
          },
          bestTrustworthyOverallEvaluationId: 7644260,
          bestTrustworthyPerLanguage: {
            cpp: 7644260,
          },
          bestFastPerLanguage: {
            cpp: 7644260,
          },
          bestOfficialPerLanguage: {},
          suspiciousCandidateEvaluationIds: [],
          duplicateEvaluationIds: [],
          orderedUserEvaluationIds: [7644260],
        },
      ],
    });
  });

  test('does not let tiny-source alone disqualify a legitimate 100-point language from trustworthy ranking', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-ranking-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'snapshot-2026-03-18-tiny-source',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });
    const evaluationsRoot = join(snapshot.normalizedRoot, 'evaluations');
    mkdirSync(evaluationsRoot, { recursive: true });

    writeFileSync(
      join(evaluationsRoot, '1362-34073368.json'),
      JSON.stringify({
        evaluationId: 34073368,
        problemId: 1362,
        problemName: 'sum2',
        problemSlug: 'sum2',
        language: 'py3',
        user: 'Prekzursil',
        score: 100,
        verdictSummary: '100 puncte',
        runtimeSeconds: 0.001,
        memoryKb: 64,
        sourceAvailable: true,
        sourceCode: 'n=int(input())\\nprint(n*n)\\n',
        suspicionFlags: ['tiny-source'],
        tests: [],
        fetchedAt: '2026-03-18T00:00:00.000Z',
        provenance: ['user-solutions'],
      }),
      'utf8',
    );

    await runRankingWorkflow(workspaceRoot);
    const summary = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'rankings', 'best-submissions.json'), 'utf8'),
    );

    expect(summary).toEqual({
      generatedAt: expect.any(String),
      problems: [
        {
          problemId: 1362,
          bestUserOverallEvaluationId: 34073368,
          bestUserPerLanguage: {
            py: 34073368,
          },
          bestTrustworthyOverallEvaluationId: 34073368,
          bestTrustworthyPerLanguage: {
            py: 34073368,
          },
          bestFastPerLanguage: {
            py: 34073368,
          },
          bestOfficialPerLanguage: {},
          suspiciousCandidateEvaluationIds: [],
          duplicateEvaluationIds: [],
          orderedUserEvaluationIds: [34073368],
        },
      ],
    });
  });
});
