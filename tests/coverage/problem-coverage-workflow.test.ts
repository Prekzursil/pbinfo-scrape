import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { runProblemCoverageWorkflow } from '../../src/workflows/problem-coverage-workflow.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('runProblemCoverageWorkflow', () => {
  test('derives truthful per-problem coverage records from normalized canonical artifacts', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-'));
    tempDirs.push(workspaceRoot);

    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            userHandle: 'Prekzursil',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'acceptance-20260310b',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'evaluations'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'tests'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'rankings', 'problems'), {
      recursive: true,
    });
    mkdirSync(join(snapshot.normalizedRoot, 'sources'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'user-solutions'), { recursive: true });

    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-1.json'),
      JSON.stringify(
        {
          id: 1,
          slug: 'sum',
          name: 'Sum',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/1/sum',
          grade: 5,
          categoryChain: [],
          tags: ['intro'],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'hidden',
          editorial: {
            availability: 'restricted',
            artifactPath: 'raw-pages/page-problem-1-solution.html',
          },
          officialSolutions: {},
          officialSourceIds: {},
          visibleTests: [],
          linkedAssets: [],
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/sum',
          metadata: {},
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-3716.json'),
      JSON.stringify(
        {
          id: 3716,
          slug: 'crossword',
          name: 'Crossword',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/3716/crossword',
          grade: 11,
          categoryChain: [],
          tags: ['strings', 'matrix'],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'visible',
          editorial: {
            availability: 'visible',
            artifactPath: 'raw-pages/page-problem-3716-solution.html',
          },
          officialSolutions: {
            cpp: '// editorial snippet',
          },
          officialSourceIds: {},
          visibleTests: [],
          linkedAssets: [],
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/3716/crossword',
          metadata: {},
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'statement-1.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-enunt.php?id=1',
        kind: 'problem-statement',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-1-statement.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'solution-1.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-solutie.php?id=1',
        kind: 'problem-solution',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-1-solution.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'tests-1.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-teste.php?id=1',
        kind: 'problem-tests',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-1-tests.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'statement-3716.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-enunt.php?id=3716',
        kind: 'problem-statement',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-3716-statement.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'solution-3716.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-solutie.php?id=3716',
        kind: 'problem-solution',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-3716-solution.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'tests-3716.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-teste.php?id=3716',
        kind: 'problem-tests',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-3716-tests.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-63332367.json'),
      JSON.stringify(
        {
          evaluationId: 63332367,
          problemId: 3716,
          problemSlug: 'crossword',
          problemName: 'Crossword',
          language: 'c',
          user: 'Andrei Visalon (Prekzursil)',
          score: 100,
          verdictSummary: 'accepted',
          sourceAvailable: false,
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-10T00:00:00.000Z',
          provenance: ['https://www.pbinfo.ro/detalii-evaluare/63332367'],
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'tests', 'problem-1.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          problemId: 1,
          problemSlug: 'sum',
          problemName: 'Sum',
          examples: [
            {
              testId: 'example-1',
              kind: 'example',
              input: '1 2',
              output: '3',
            },
          ],
          visible: [],
          evaluationObserved: [],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'tests', 'problem-3716.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          problemId: 3716,
          problemSlug: 'crossword',
          problemName: 'Crossword',
          examples: [],
          visible: [],
          evaluationObserved: [
            {
              testId: 'evaluation-63332367-test-1',
              kind: 'evaluationObserved',
              evaluationId: 63332367,
              index: 1,
              details: 'Exemplu',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'rankings', 'best-submissions.json'),
      JSON.stringify(
        {
          generatedAt: '2026-03-10T00:00:00.000Z',
          problems: [
            {
              problemId: 3716,
              bestUserOverallEvaluationId: 63332367,
              bestUserPerLanguage: {
                c: 63332367,
              },
              bestOfficialPerLanguage: {},
              orderedUserEvaluationIds: [63332367],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'rankings', 'problems', 'problem-3716.json'),
      JSON.stringify(
        {
          problemId: 3716,
          bestUserOverallEvaluationId: 63332367,
          bestUserPerLanguage: {
            c: 63332367,
          },
          bestOfficialPerLanguage: {},
          orderedUserEvaluationIds: [63332367],
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
      JSON.stringify(
        {
          user: 'Prekzursil',
          sourceUrl: 'https://www.pbinfo.ro/solutii/user/Prekzursil',
          totalMatches: 2,
          throttled: false,
          entries: [
            {
              user: 'Andrei Visalon (Prekzursil)',
              problemId: 3716,
              problemSlug: 'crossword',
              problemName: 'Crossword',
              evaluationId: 63332367,
            },
            {
              user: 'Andrei Visalon (Prekzursil)',
              problemId: 3716,
              problemSlug: 'crossword',
              problemName: 'Crossword',
              evaluationId: 63332380,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.problemsCovered).toBe(2);

    const index = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'problem-coverage', 'index.json'), 'utf8'),
    ) as {
      totals: {
        totalProblems: number;
        solvedByMeCount: number;
        problemsWithExamples: number;
        problemsWithVisibleTestsCaptured: number;
        problemsWithEvaluationObservedTests: number;
        problemsWithArchivedSources: number;
      };
      records: Array<Record<string, unknown>>;
    };

    expect(index.totals).toEqual(
      expect.objectContaining({
        totalProblems: 2,
        solvedByMeCount: 1,
        problemsWithExamples: 1,
        problemsWithVisibleTestsCaptured: 0,
        problemsWithEvaluationObservedTests: 1,
        problemsWithArchivedSources: 0,
        statementArchivedCount: 2,
        solutionFragmentArchivedCount: 2,
        testsFragmentArchivedCount: 2,
      }),
    );

    const unsolved = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'problem-1.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const solved = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'problem-3716.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(unsolved).toEqual(
      expect.objectContaining({
        problemId: 1,
        solvedByMe: false,
        evaluationCount: 0,
        solvedEvaluationCount: 0,
        rankingPresent: false,
        statementArchived: true,
        solutionFragmentArchived: true,
        testsFragmentArchived: true,
        exampleTestsAvailableCount: 1,
        visibleTestsCapturedCount: 0,
        evaluationObservedTestsCount: 0,
        officialSolutionPresent: true,
        editorialAvailability: 'hidden',
        sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/sum',
        officialSourceArchived: false,
        officialSourceCount: 0,
        userSourceArchived: false,
        userSourceCount: 0,
        hasAnyArchivedSource: false,
      }),
    );
    expect(unsolved.notes).toEqual(
      expect.arrayContaining([
        'Editorial/solution fragment archived, but official source code is not archived yet.',
        'Tests fragment archived, no visible test cases parsed.',
        'Example tests available: 1.',
        'Source list available upstream, no archived source code yet.',
      ]),
    );

    expect(solved).toEqual(
      expect.objectContaining({
        problemId: 3716,
        solvedByMe: true,
        evaluationCount: 1,
        solvedEvaluationCount: 1,
        rankingPresent: true,
        statementArchived: true,
        solutionFragmentArchived: true,
        testsFragmentArchived: true,
        exampleTestsAvailableCount: 0,
        visibleTestsCapturedCount: 0,
        evaluationObservedTestsCount: 1,
        officialSolutionPresent: true,
        editorialAvailability: 'visible',
        officialSourceArchived: false,
        officialSourceCount: 0,
        userSourceArchived: false,
        userSourceCount: 0,
        hasAnyArchivedSource: false,
      }),
    );
    expect(solved.notes).toEqual(
      expect.arrayContaining([
        'Editorial/solution fragment archived, but official source code is not archived yet.',
        'Tests fragment archived, no visible test cases parsed.',
        'Evaluation-observed tests archived: 1.',
        'Source list available upstream, no archived source code yet.',
      ]),
    );
    expect(index.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          problemId: 1,
          solvedByMe: false,
        }),
        expect.objectContaining({
          problemId: 3716,
          solvedByMe: true,
        }),
      ]),
    );
  });

  test('does not mark foreign entries in a matching user feed as solved-by-me', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-'));
    tempDirs.push(workspaceRoot);

    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            userHandle: 'Prekzursil',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'candidate-mixed-feed-entries',
      scope: 'all',
      now: new Date('2026-03-15T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'evaluations'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'user-solutions'), { recursive: true });

    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-1.json'),
      JSON.stringify(
        {
          id: 1,
          slug: 'sum',
          name: 'Sum',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/1/sum',
          grade: 5,
          categoryChain: [],
          tags: [],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'hidden',
          editorial: {
            availability: 'hidden',
          },
          officialSolutions: {},
          officialSourceIds: {},
          visibleTests: [],
          linkedAssets: [],
          metadata: {},
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-2.json'),
      JSON.stringify(
        {
          id: 2,
          slug: 'diff',
          name: 'Diff',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/2/diff',
          grade: 5,
          categoryChain: [],
          tags: [],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'hidden',
          editorial: {
            availability: 'hidden',
          },
          officialSolutions: {},
          officialSourceIds: {},
          visibleTests: [],
          linkedAssets: [],
          metadata: {},
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
      JSON.stringify(
        {
          user: 'Prekzursil',
          sourceUrl: 'https://www.pbinfo.ro/solutii/user/Prekzursil',
          totalMatches: 2,
          throttled: false,
          entries: [
            {
              user: 'Andrei Visalon (Prekzursil)',
              problemId: 1,
              evaluationId: 1001,
            },
            {
              user: 'Alt User',
              problemId: 2,
              evaluationId: 2002,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-1001.json'),
      JSON.stringify(
        {
          evaluationId: 1001,
          problemId: 1,
          problemSlug: 'sum',
          problemName: 'Sum',
          language: 'cpp',
          user: 'Andrei Visalon (Prekzursil)',
          score: 100,
          verdictSummary: '100 puncte',
          sourceAvailable: false,
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-15T00:00:00.000Z',
          provenance: ['https://www.pbinfo.ro/detalii-evaluare/1001'],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-2002.json'),
      JSON.stringify(
        {
          evaluationId: 2002,
          problemId: 2,
          problemSlug: 'diff',
          problemName: 'Diff',
          language: 'cpp',
          user: 'Alt User',
          score: 100,
          verdictSummary: '100 puncte',
          sourceAvailable: false,
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-15T00:00:00.000Z',
          provenance: ['https://www.pbinfo.ro/detalii-evaluare/2002'],
        },
        null,
        2,
      ),
      'utf8',
    );

    await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    const index = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'problem-coverage', 'index.json'), 'utf8'),
    ) as {
      totals: {
        solvedByMeCount: number;
      };
      records: Array<{
        problemId: number;
        solvedByMe: boolean;
      }>;
    };

    expect(index.totals.solvedByMeCount).toBe(1);
    expect(index.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          problemId: 1,
          solvedByMe: true,
        }),
        expect.objectContaining({
          problemId: 2,
          solvedByMe: false,
        }),
      ]),
    );
  });

  test('requires successful evaluations before marking solved-by-me', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-'));
    tempDirs.push(workspaceRoot);

    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            userHandle: 'Prekzursil',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'candidate-solved-threshold',
      scope: 'all',
      now: new Date('2026-03-15T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'evaluations'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'user-solutions'), { recursive: true });

    for (const [id, slug, name] of [
      [10, 'a', 'A'],
      [11, 'b', 'B'],
    ] as const) {
      writeFileSync(
        join(snapshot.normalizedRoot, 'problems', `problem-${id}.json`),
        JSON.stringify(
          {
            id,
            slug,
            name,
            canonicalUrl: `https://www.pbinfo.ro/probleme/${id}/${slug}`,
            grade: 5,
            categoryChain: [],
            tags: [],
            sections: [],
            examples: [],
            constraints: [],
            editorialAvailability: 'hidden',
            editorial: {
              availability: 'hidden',
            },
            officialSolutions: {},
            officialSourceIds: {},
            visibleTests: [],
            linkedAssets: [],
            metadata: {},
          },
          null,
          2,
        ),
        'utf8',
      );
    }

    writeFileSync(
      join(snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
      JSON.stringify(
        {
          user: 'Prekzursil',
          sourceUrl: 'https://www.pbinfo.ro/solutii/user/Prekzursil',
          totalMatches: 2,
          throttled: false,
          entries: [
            {
              user: 'Andrei Visalon (Prekzursil)',
              problemId: 10,
              evaluationId: 10001,
            },
            {
              user: 'Andrei Visalon (Prekzursil)',
              problemId: 11,
              evaluationId: 10002,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-10001.json'),
      JSON.stringify(
        {
          evaluationId: 10001,
          problemId: 10,
          problemSlug: 'a',
          problemName: 'A',
          language: 'cpp',
          user: 'Andrei Visalon (Prekzursil)',
          score: 40,
          verdictSummary: '40 puncte',
          sourceAvailable: false,
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-15T00:00:00.000Z',
          provenance: ['https://www.pbinfo.ro/detalii-evaluare/10001'],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-10002.json'),
      JSON.stringify(
        {
          evaluationId: 10002,
          problemId: 11,
          problemSlug: 'b',
          problemName: 'B',
          language: 'cpp',
          user: 'Andrei Visalon (Prekzursil)',
          score: 100,
          verdictSummary: '100 puncte',
          sourceAvailable: false,
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-15T00:00:00.000Z',
          provenance: ['https://www.pbinfo.ro/detalii-evaluare/10002'],
        },
        null,
        2,
      ),
      'utf8',
    );

    await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    const index = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'problem-coverage', 'index.json'), 'utf8'),
    ) as {
      totals: {
        solvedByMeCount: number;
      };
      records: Array<{
        problemId: number;
        solvedByMe: boolean;
      }>;
    };

    expect(index.totals.solvedByMeCount).toBe(1);
    expect(index.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          problemId: 10,
          solvedByMe: false,
        }),
        expect.objectContaining({
          problemId: 11,
          solvedByMe: true,
        }),
      ]),
    );
  });
});
