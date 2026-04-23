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
        problemsWithEffectiveTests: number;
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
        problemsWithEffectiveTests: 1,
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
        effectiveTestsAvailableCount: 1,
        officialSolutionPresent: true,
        editorialAvailability: 'hidden',
        sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/sum',
        officialSourceArchived: false,
        officialSourceCount: 0,
        officialSourceLanguages: [],
        userSourceArchived: false,
        userSourceCount: 0,
        userSourceLanguages: [],
        trustworthyUserSourceLanguages: [],
        missingTrustworthyUserSourceLanguages: [],
        hasAnyArchivedSource: false,
        testsAvailable: true,
        unsolvedByConfiguredHandle: true,
      }),
    );
    expect(unsolved.notes).toEqual(
      expect.arrayContaining([
        'Editorial/solution fragment archived, but official source code is not archived yet.',
        'Tests fragment archived, no visible test cases parsed.',
        'Example tests available: 1.',
        'Community source list exists upstream, but it is not counted as archived official source code.',
        'Effective deduplicated tests available: 1.',
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
        effectiveTestsAvailableCount: 0,
        officialSolutionPresent: true,
        editorialAvailability: 'visible',
        officialSourceArchived: false,
        officialSourceCount: 0,
        officialSourceLanguages: [],
        userSourceArchived: false,
        userSourceCount: 0,
        userSourceLanguages: [],
        trustworthyUserSourceLanguages: [],
        missingTrustworthyUserSourceLanguages: ['c'],
        hasAnyArchivedSource: false,
        testsAvailable: true,
        unsolvedByConfiguredHandle: false,
      }),
    );
    expect(solved.notes).toEqual(
      expect.arrayContaining([
        'Editorial/solution fragment archived, but official source code is not archived yet.',
        'Tests fragment archived, no visible test cases parsed.',
        'Evaluation-observed tests archived: 1.',
        'Community source list exists upstream, but it is not counted as archived official source code.',
        'Missing trustworthy 100-point user source languages: c.',
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

  test('handles baseline coverage indexes written before effective-test and trustworthy-language fields existed', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-baseline-compat-'));
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
    const baseline = prepareSnapshot(config, {
      snapshotId: 'acceptance-20260310b',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    mkdirSync(join(baseline.normalizedRoot, 'problem-coverage'), { recursive: true });
    writeFileSync(
      join(baseline.normalizedRoot, 'problem-coverage', 'index.json'),
      JSON.stringify(
        {
          snapshotId: baseline.snapshotId,
          generatedAt: '2026-03-10T00:00:00.000Z',
          totals: {
            totalProblems: 1,
            solvedByMeCount: 0,
            statementArchivedCount: 1,
            solutionFragmentArchivedCount: 0,
            testsFragmentArchivedCount: 0,
            problemsWithExamples: 0,
            problemsWithVisibleTestsCaptured: 0,
            problemsWithEvaluationObservedTests: 0,
            problemsWithArchivedSources: 0,
            problemsWithOfficialSourceArchived: 0,
            problemsWithUserSourceArchived: 0,
            editorialVisibleCount: 0,
            rankingPresentCount: 0,
          },
          records: [
            {
              snapshotId: baseline.snapshotId,
              problemId: 1,
              slug: 'sum',
              name: 'Sum',
              mirrorRoute: '/probleme/1/sum',
              tags: [],
              solvedByMe: false,
              evaluationCount: 0,
              solvedEvaluationCount: 0,
              rankingPresent: false,
              statementArchived: true,
              solutionFragmentArchived: false,
              testsFragmentArchived: false,
              exampleTestsAvailableCount: 0,
              visibleTestsCapturedCount: 0,
              evaluationObservedTestsCount: 0,
              officialSolutionPresent: false,
              editorialAvailability: 'hidden',
              officialSourceArchived: false,
              officialSourceCount: 0,
              officialSourceIds: [],
              userSourceArchived: false,
              userSourceCount: 0,
              userSourceIds: [],
              hasAnyArchivedSource: false,
              evaluationIds: [],
              notes: [],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const candidate = prepareSnapshot(config, {
      snapshotId: 'candidate-20260316-1900',
      scope: 'all',
      now: new Date('2026-03-16T19:00:00.000Z'),
    });
    mkdirSync(join(candidate.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(candidate.normalizedRoot, 'pages'), { recursive: true });
    mkdirSync(join(candidate.normalizedRoot, 'evaluations'), { recursive: true });
    mkdirSync(join(candidate.normalizedRoot, 'tests'), { recursive: true });
    mkdirSync(join(candidate.normalizedRoot, 'sources'), { recursive: true });
    mkdirSync(join(candidate.normalizedRoot, 'user-solutions'), { recursive: true });
    mkdirSync(join(candidate.normalizedRoot, 'rankings', 'problems'), { recursive: true });

    writeFileSync(
      join(candidate.normalizedRoot, 'problems', 'problem-1.json'),
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
      join(candidate.normalizedRoot, 'pages', 'page-problem-1.json'),
      JSON.stringify(
        {
          snapshotId: candidate.snapshotId,
          url: 'https://www.pbinfo.ro/probleme/1/sum',
          kind: 'public-page',
          httpStatus: 200,
          bodyPath: 'raw-pages/page-problem-1.html',
          fetchedAt: '2026-03-16T19:00:00.000Z',
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(runProblemCoverageWorkflow(workspaceRoot, candidate.snapshotId)).resolves.toEqual(
      expect.objectContaining({
        snapshotId: candidate.snapshotId,
      }),
    );

    const index = JSON.parse(
      readFileSync(join(candidate.normalizedRoot, 'problem-coverage', 'index.json'), 'utf8'),
    ) as {
      records: Array<{
        problemId: number;
        newSinceBaseline: boolean;
      }>;
    };

    expect(index.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          problemId: 1,
          newSinceBaseline: false,
        }),
      ]),
    );
  });

  test('does not count public solution-list sources as official or configured-user coverage', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-public-sources-'));
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
      snapshotId: 'candidate-public-sources',
      scope: 'all',
      now: new Date('2026-03-17T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'sources'), { recursive: true });

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
          editorialAvailability: 'visible',
          officialSolutions: {},
          officialSourceIds: {},
          userSourceIds: {},
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
      join(snapshot.normalizedRoot, 'sources', 'public-cpp.json'),
      JSON.stringify(
        {
          sourceId: 'public-cpp',
          kind: 'user-solution-page',
          problemId: 1,
          evaluationId: 70000001,
          userHandle: 'Someone Else',
          language: 'cpp',
          score: 100,
          sourceAvailable: true,
          sourceCode: 'int main(){return 0;}',
          suspicionFlags: [],
          provenance: ['https://www.pbinfo.ro/solutii/problema/1/sum'],
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    expect(result.problemsCovered).toBe(1);

    const record = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'problem-1.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(record).toEqual(
      expect.objectContaining({
        problemId: 1,
        officialSourceArchived: false,
        officialSourceCount: 0,
        userSourceArchived: false,
        userSourceCount: 0,
        userSourceLanguages: [],
        hasAnyArchivedSource: false,
      }),
    );
    expect(record.notes).toEqual(
      expect.arrayContaining([
        'Community source list exists upstream, but it is not counted as archived official source code.',
      ]),
    );
  });

  test('normalizes source and ranking languages consistently for trustworthy coverage requirements', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-language-'));
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
      snapshotId: 'candidate-language-normalization',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'evaluations'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'sources'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'user-solutions'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'rankings', 'problems'), { recursive: true });

    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-49.json'),
      JSON.stringify(
        {
          id: 49,
          slug: 'factorial',
          name: 'Factorial',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/49/factorial',
          grade: 9,
          categoryChain: [],
          tags: [],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'visible',
          officialSolutions: {},
          officialSourceIds: {},
          userSourceIds: {},
          visibleTests: [],
          linkedAssets: [],
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/49/factorial',
          metadata: {},
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-16187760.json'),
      JSON.stringify(
        {
          evaluationId: 16187760,
          problemId: 49,
          problemSlug: 'factorial',
          language: 'py3',
          user: 'Prekzursil',
          score: 100,
          sourceAvailable: true,
          sourceCode: 'n=int(input())\nprint(1 if n < 2 else n)\n',
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-18T00:00:00.000Z',
          provenance: ['user-solutions'],
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'sources', 'evaluation-16187760.json'),
      JSON.stringify(
        {
          sourceId: 'evaluation-16187760',
          kind: 'user-evaluation',
          problemId: 49,
          evaluationId: 16187760,
          userHandle: 'Prekzursil',
          language: 'py3',
          score: 100,
          sourceAvailable: true,
          sourceCode: 'n=int(input())\nprint(1 if n < 2 else n)\n',
          sourceHash: 'sha256:test',
          normalizedSourceHash: 'sha256:test-normalized',
          sourceLength: 41,
          fetchedAt: '2026-03-18T00:00:00.000Z',
          suspicionFlags: [],
          provenance: ['user-solutions'],
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
          entries: [
            {
              user: 'Prekzursil',
              problemId: 49,
              evaluationId: 16187760,
              score: 100,
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
          generatedAt: '2026-03-18T00:00:00.000Z',
          problems: [
            {
              problemId: 49,
              bestUserOverallEvaluationId: 16187760,
              bestUserPerLanguage: {
                py: 16187760,
              },
              bestTrustworthyOverallEvaluationId: 16187760,
              bestTrustworthyPerLanguage: {
                py: 16187760,
              },
              bestFastPerLanguage: {
                py: 16187760,
              },
              bestOfficialPerLanguage: {},
              suspiciousCandidateEvaluationIds: [],
              duplicateEvaluationIds: [],
              orderedUserEvaluationIds: [16187760],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    const record = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'problem-49.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(record).toEqual(
      expect.objectContaining({
        problemId: 49,
        solvedByMe: true,
        userSourceArchived: true,
        userSourceLanguages: ['py'],
        trustworthyUserSourceLanguages: ['py'],
        missingTrustworthyUserSourceLanguages: [],
      }),
    );
  });

  test('does not require sub-100 attempted languages in missing trustworthy coverage gaps', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-sub100-languages-'));
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
      snapshotId: 'candidate-sub100-language-gaps',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'evaluations'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'sources'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'user-solutions'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'rankings', 'problems'), { recursive: true });

    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-284.json'),
      JSON.stringify(
        {
          id: 284,
          slug: 'stergere',
          name: 'Stergere',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/284/stergere',
          grade: 7,
          categoryChain: [],
          tags: [],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'visible',
          officialSolutions: {},
          officialSourceIds: {},
          userSourceIds: {},
          visibleTests: [],
          linkedAssets: [],
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/284/stergere',
          metadata: {},
        },
        null,
        2,
      ),
      'utf8',
    );

    const evaluations = [
      {
        evaluationId: 10285150,
        problemId: 284,
        problemSlug: 'stergere',
        language: 'cpp',
        user: 'Prekzursil',
        score: 100,
        sourceAvailable: true,
        sourceCode: 'int main(){return 0;}',
        suspicionFlags: [],
        tests: [],
        fetchedAt: '2026-03-18T00:00:00.000Z',
        provenance: ['user-solutions'],
      },
      {
        evaluationId: 10232087,
        problemId: 284,
        problemSlug: 'stergere',
        language: 'pas',
        user: 'Prekzursil',
        score: 20,
        sourceAvailable: true,
        sourceCode: 'begin writeln(0); end.',
        suspicionFlags: [],
        tests: [],
        fetchedAt: '2026-03-18T00:00:00.000Z',
        provenance: ['user-solutions'],
      },
    ];
    for (const evaluation of evaluations) {
      writeFileSync(
        join(snapshot.normalizedRoot, 'evaluations', `evaluation-${evaluation.evaluationId}.json`),
        JSON.stringify(evaluation, null, 2),
        'utf8',
      );
    }

    writeFileSync(
      join(snapshot.normalizedRoot, 'sources', 'evaluation-10285150.json'),
      JSON.stringify(
        {
          sourceId: 'evaluation-10285150',
          kind: 'user-evaluation',
          problemId: 284,
          evaluationId: 10285150,
          userHandle: 'Prekzursil',
          language: 'cpp',
          score: 100,
          sourceAvailable: true,
          sourceCode: 'int main(){return 0;}',
          sourceHash: 'sha256:cpp',
          normalizedSourceHash: 'sha256:cpp-normalized',
          sourceLength: 21,
          fetchedAt: '2026-03-18T00:00:00.000Z',
          suspicionFlags: [],
          provenance: ['user-solutions'],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'sources', 'evaluation-10232087.json'),
      JSON.stringify(
        {
          sourceId: 'evaluation-10232087',
          kind: 'user-evaluation',
          problemId: 284,
          evaluationId: 10232087,
          userHandle: 'Prekzursil',
          language: 'pas',
          score: 20,
          sourceAvailable: true,
          sourceCode: 'begin writeln(0); end.',
          sourceHash: 'sha256:pas',
          normalizedSourceHash: 'sha256:pas-normalized',
          sourceLength: 22,
          fetchedAt: '2026-03-18T00:00:00.000Z',
          suspicionFlags: [],
          provenance: ['user-solutions'],
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
          entries: [
            {
              user: 'Prekzursil',
              problemId: 284,
              evaluationId: 10285150,
              score: 100,
            },
            {
              user: 'Prekzursil',
              problemId: 284,
              evaluationId: 10232087,
              score: 20,
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
          generatedAt: '2026-03-18T00:00:00.000Z',
          problems: [
            {
              problemId: 284,
              bestUserOverallEvaluationId: 10285150,
              bestUserPerLanguage: {
                cpp: 10285150,
                pas: 10232087,
              },
              bestTrustworthyOverallEvaluationId: 10285150,
              bestTrustworthyPerLanguage: {
                cpp: 10285150,
              },
              bestFastPerLanguage: {
                cpp: 10285150,
                pas: 10232087,
              },
              bestOfficialPerLanguage: {},
              suspiciousCandidateEvaluationIds: [],
              duplicateEvaluationIds: [],
              orderedUserEvaluationIds: [10285150, 10232087],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    const record = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'problem-284.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(record).toEqual(
      expect.objectContaining({
        problemId: 284,
        solvedByMe: true,
        userSourceArchived: true,
        userSourceLanguages: ['cpp', 'pas'],
        requiredTrustworthyUserSourceLanguages: ['cpp'],
        trustworthyUserSourceLanguages: ['cpp'],
        missingTrustworthyUserSourceLanguages: [],
      }),
    );
  });

  test('requires a trustworthy archived source for each solved 100-point language and exposes per-language winners', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-multilang-trustworthy-'));
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
      snapshotId: 'candidate-multilang-trustworthy-gaps',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'evaluations'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'sources'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'user-solutions'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'rankings', 'problems'), { recursive: true });

    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-285.json'),
      JSON.stringify(
        {
          id: 285,
          slug: 'multilang',
          name: 'MultiLang',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/285/multilang',
          grade: 7,
          categoryChain: [],
          tags: ['strings'],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'unknown',
          officialSolutions: {},
          officialSourceIds: {},
          userSourceIds: {},
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
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-20285150.json'),
      JSON.stringify(
        {
          evaluationId: 20285150,
          problemId: 285,
          problemSlug: 'multilang',
          problemName: 'MultiLang',
          language: 'cpp',
          user: 'Prekzursil',
          score: 100,
          verdictSummary: 'accepted',
          sourceAvailable: true,
          sourceCode: 'int main(){return 0;}',
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-18T00:00:00.000Z',
          provenance: ['evaluation-detail'],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-20285151.json'),
      JSON.stringify(
        {
          evaluationId: 20285151,
          problemId: 285,
          problemSlug: 'multilang',
          problemName: 'MultiLang',
          language: 'pas',
          user: 'Prekzursil',
          score: 100,
          verdictSummary: 'accepted',
          sourceAvailable: true,
          sourceCode: 'begin writeln(1); end.',
          suspicionFlags: ['constant-output', 'input-branching'],
          tests: [],
          fetchedAt: '2026-03-18T00:00:00.000Z',
          provenance: ['evaluation-detail'],
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'sources', 'evaluation-20285150.json'),
      JSON.stringify(
        {
          sourceId: 'evaluation-20285150',
          kind: 'user-evaluation',
          problemId: 285,
          evaluationId: 20285150,
          userHandle: 'Prekzursil',
          language: 'cpp',
          score: 100,
          sourceAvailable: true,
          sourceCode: 'int main(){return 0;}',
          sourceHash: 'sha256:cpp',
          normalizedSourceHash: 'sha256:cpp-normalized',
          sourceLength: 21,
          fetchedAt: '2026-03-18T00:00:00.000Z',
          suspicionFlags: [],
          provenance: ['user-solutions'],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'sources', 'evaluation-20285151.json'),
      JSON.stringify(
        {
          sourceId: 'evaluation-20285151',
          kind: 'user-evaluation',
          problemId: 285,
          evaluationId: 20285151,
          userHandle: 'Prekzursil',
          language: 'pas',
          score: 100,
          sourceAvailable: true,
          sourceCode: 'begin writeln(1); end.',
          sourceHash: 'sha256:pas',
          normalizedSourceHash: 'sha256:pas-normalized',
          sourceLength: 22,
          fetchedAt: '2026-03-18T00:00:00.000Z',
          suspicionFlags: ['constant-output', 'input-branching'],
          provenance: ['user-solutions'],
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
          entries: [
            {
              user: 'Prekzursil',
              problemId: 285,
              evaluationId: 20285150,
              score: 100,
            },
            {
              user: 'Prekzursil',
              problemId: 285,
              evaluationId: 20285151,
              score: 100,
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
          generatedAt: '2026-03-18T00:00:00.000Z',
          problems: [
            {
              problemId: 285,
              bestUserOverallEvaluationId: 20285150,
              bestUserPerLanguage: {
                cpp: 20285150,
                pas: 20285151,
              },
              bestTrustworthyOverallEvaluationId: 20285150,
              bestTrustworthyPerLanguage: {
                cpp: 20285150,
              },
              bestFastPerLanguage: {
                cpp: 20285150,
                pas: 20285151,
              },
              bestOfficialPerLanguage: {},
              suspiciousCandidateEvaluationIds: [20285151],
              duplicateEvaluationIds: [],
              orderedUserEvaluationIds: [20285150, 20285151],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    const record = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'problem-285.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(record).toEqual(
      expect.objectContaining({
        problemId: 285,
        solvedByMe: true,
        userSourceArchived: true,
        userSourceLanguages: ['cpp', 'pas'],
        requiredTrustworthyUserSourceLanguages: ['cpp', 'pas'],
        trustworthyUserSourceLanguages: ['cpp'],
        missingTrustworthyUserSourceLanguages: ['pas'],
        bestTrustworthyUserPerLanguage: {
          cpp: 20285150,
        },
        archiveCompletenessStatus: 'missing-user-source',
      }),
    );
  });

  test('marks missing tests and official sources as not available upstream when PBInfo does not expose them', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-upstream-unavailable-'));
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
      snapshotId: 'candidate-upstream-unavailable',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'tests'), { recursive: true });

    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-512.json'),
      JSON.stringify(
        {
          id: 512,
          slug: 'no-tests-here',
          name: 'NoTestsHere',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/512/no-tests-here',
          grade: 6,
          categoryChain: [],
          tags: [],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'unknown',
          officialSolutions: {},
          officialSourceIds: {},
          userSourceIds: {},
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
      join(snapshot.normalizedRoot, 'pages', 'tests-512.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-teste.php?id=512',
        kind: 'problem-tests',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-512-tests.html',
        fetchedAt: '2026-03-18T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'tests', 'problem-512.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          problemId: 512,
          problemSlug: 'no-tests-here',
          problemName: 'NoTestsHere',
          examples: [],
          visible: [],
          evaluationObserved: [],
          effective: [],
        },
        null,
        2,
      ),
      'utf8',
    );

    await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    const record = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'problem-512.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(record).toEqual(
      expect.objectContaining({
        problemId: 512,
        solvedByMe: false,
        testsFragmentArchived: true,
        testsCoverageStatus: 'not-available-upstream',
        officialSourceStatus: 'not-available-upstream',
        archiveCompletenessStatus: 'unsolved',
      }),
    );
    expect(record.notes).toEqual(
      expect.arrayContaining([
        'PBInfo does not currently expose example, visible, or evaluation-observed tests for this problem in the archive.',
        'PBInfo does not currently list an upstream official source page for this problem.',
      ]),
    );
  });

  test('marks official sources as not available upstream when harvested official evaluations expose no source body', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-official-harvested-no-source-'));
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
      snapshotId: 'candidate-official-harvested-no-source',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'evaluations'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'sources'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'user-solutions'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'rankings', 'problems'), { recursive: true });

    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-19.json'),
      JSON.stringify(
        {
          id: 19,
          slug: 'bfs',
          name: 'BFS',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/19/bfs',
          grade: 11,
          categoryChain: [],
          tags: [],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'visible',
          editorial: {
            availability: 'visible',
            artifactPath: 'raw-pages/page-problem-19-solution.html',
          },
          officialSolutions: {},
          officialSourceIds: {},
          userSourceIds: {
            cpp: ['evaluation-20058309'],
          },
          visibleTests: [],
          linkedAssets: [],
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/19/bfs',
          metadata: {
            authorHandle: 'Vasilut',
          },
          officialSourceHarvest: {
            sourceListHarvested: true,
            sourceListPageUrl: 'https://www.pbinfo.ro/solutii/user/Vasilut/problema/19/bfs',
            authorHandle: 'Vasilut',
            qualifyingEvaluationIds: [1492],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'statement-19.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-enunt.php?id=19',
        kind: 'problem-statement',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-19-statement.html',
        fetchedAt: '2026-03-18T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'solution-19.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-solutie.php?id=19',
        kind: 'problem-solution',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-19-solution.html',
        fetchedAt: '2026-03-18T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'tests-19.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-teste.php?id=19',
        kind: 'problem-tests',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-19-tests.html',
        fetchedAt: '2026-03-18T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-1492.json'),
      JSON.stringify(
        {
          evaluationId: 1492,
          problemId: 19,
          problemSlug: 'bfs',
          problemName: 'BFS',
          language: 'cpp',
          user: 'Vasilut Lucian (Vasilut)',
          score: 100,
          verdictSummary: '100 puncte',
          runtimeSeconds: 1,
          memoryKb: 128,
          sourceAvailable: false,
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-18T00:00:00.000Z',
          provenance: ['https://www.pbinfo.ro/detalii-evaluare/1492'],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-20058309.json'),
      JSON.stringify(
        {
          evaluationId: 20058309,
          problemId: 19,
          problemSlug: 'bfs',
          problemName: 'BFS',
          language: 'cpp',
          user: 'Prekzursil',
          score: 100,
          verdictSummary: 'accepted',
          sourceAvailable: true,
          sourceCode: 'int main(){return 0;}',
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-18T00:00:00.000Z',
          provenance: ['https://www.pbinfo.ro/detalii-evaluare/20058309'],
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'sources', 'evaluation-20058309.json'),
      JSON.stringify(
        {
          sourceId: 'evaluation-20058309',
          kind: 'user-evaluation',
          problemId: 19,
          evaluationId: 20058309,
          userHandle: 'Prekzursil',
          language: 'cpp',
          score: 100,
          sourceAvailable: true,
          sourceCode: 'int main(){return 0;}',
          sourceHash: 'sha256:user',
          normalizedSourceHash: 'sha256:user-normalized',
          sourceLength: 21,
          fetchedAt: '2026-03-18T00:00:00.000Z',
          suspicionFlags: [],
          provenance: ['evaluation-detail'],
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
          entries: [
            {
              user: 'Prekzursil',
              problemId: 19,
              evaluationId: 20058309,
              score: 100,
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
          generatedAt: '2026-03-18T00:00:00.000Z',
          problems: [
            {
              problemId: 19,
              bestUserOverallEvaluationId: 20058309,
              bestUserPerLanguage: { cpp: 20058309 },
              bestTrustworthyOverallEvaluationId: 20058309,
              bestTrustworthyPerLanguage: { cpp: 20058309 },
              bestFastPerLanguage: { cpp: 20058309 },
              bestOfficialPerLanguage: {},
              suspiciousCandidateEvaluationIds: [],
              duplicateEvaluationIds: [],
              orderedUserEvaluationIds: [20058309],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    const record = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'problem-19.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(record).toEqual(
      expect.objectContaining({
        problemId: 19,
        officialSourceArchived: false,
        officialSourceStatus: 'not-available-upstream',
        archiveCompletenessStatus: 'complete',
      }),
    );
  });

  test('derives progressState + bestScore + evaluationTimeline + languagesTried from evaluations', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-progress-'));
    tempDirs.push(workspaceRoot);

    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify({ crawl: { userHandle: 'Prekzursil' } }, null, 2),
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
    mkdirSync(join(snapshot.normalizedRoot, 'rankings', 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'sources'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'user-solutions'), { recursive: true });

    // Problem with 3 evaluations: partial 60pt cpp, partial 80pt cpp, solved 100pt py
    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-42.json'),
      JSON.stringify(
        {
          id: 42,
          slug: 'maxchain',
          name: 'MaxChain',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/42/maxchain',
          categoryChain: [],
          tags: [],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'unknown',
          officialSolutions: {},
          visibleTests: [],
          linkedAssets: [],
          metadata: {},
        },
        null,
        2,
      ),
      'utf8',
    );

    const evaluations = [
      { id: 500, lang: 'cpp', score: 60, fetched: '2026-03-05T10:00:00.000Z' },
      { id: 510, lang: 'cpp', score: 80, fetched: '2026-03-07T10:00:00.000Z' },
      { id: 520, lang: 'py', score: 100, fetched: '2026-03-09T10:00:00.000Z' },
    ];
    for (const e of evaluations) {
      writeFileSync(
        join(snapshot.normalizedRoot, 'evaluations', `evaluation-${e.id}.json`),
        JSON.stringify(
          {
            evaluationId: e.id,
            problemId: 42,
            problemSlug: 'maxchain',
            problemName: 'MaxChain',
            language: e.lang,
            user: 'Prekzursil',
            score: e.score,
            verdictSummary: e.score >= 100 ? 'accepted' : 'partial',
            sourceAvailable: e.score >= 100,
            suspicionFlags: [],
            tests: [],
            fetchedAt: e.fetched,
            provenance: [`https://www.pbinfo.ro/detalii-evaluare/${e.id}`],
          },
          null,
          2,
        ),
        'utf8',
      );
    }

    // User-solutions feed that matches handle so solvedByMe derivation triggers
    writeFileSync(
      join(snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
      JSON.stringify(
        {
          user: 'Prekzursil',
          entries: evaluations.map((e) => ({
            user: 'Prekzursil',
            problemId: 42,
            evaluationId: e.id,
            score: e.score,
          })),
        },
        null,
        2,
      ),
      'utf8',
    );

    await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    const coverage = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'problem-42.json'),
        'utf8',
      ),
    );

    expect(coverage.progressState).toBe('solved');
    expect(coverage.bestScore).toBe(100);
    expect(coverage.lastAttemptAt).toBe('2026-03-09T10:00:00.000Z');
    expect(coverage.languagesTried).toEqual(['cpp', 'py']);
    expect(coverage.evaluationTimeline).toHaveLength(3);
    // newest first
    expect(coverage.evaluationTimeline[0]?.evaluationId).toBe(520);
    expect(coverage.evaluationTimeline[0]?.sourceAvailable).toBe(true);
    expect(coverage.evaluationTimeline[1]?.evaluationId).toBe(510);
    // 80pt partial -> sourceAvailable gated to false even if evaluation record had it true
    expect(coverage.evaluationTimeline[1]?.sourceAvailable).toBe(false);
    expect(coverage.evaluationTimeline[2]?.evaluationId).toBe(500);

    const index = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'index.json'),
        'utf8',
      ),
    );
    expect(index.totals.progressStateCounts).toEqual({
      solved: 1,
      partial: 0,
      notAttempted: 0,
    });
  });

  test('derives official harvest availability from archived official-source-list pages when problem metadata is missing', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-official-harvest-derived-'));
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
      snapshotId: 'candidate-official-harvest-derived',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'evaluations'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'sources'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'user-solutions'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'rankings', 'problems'), { recursive: true });
    mkdirSync(snapshot.rawPagesRoot, { recursive: true });

    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-19.json'),
      JSON.stringify(
        {
          id: 19,
          slug: 'bfs',
          name: 'BFS',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/19/bfs',
          grade: 11,
          categoryChain: [],
          tags: [],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'visible',
          editorial: {
            availability: 'visible',
            artifactPath: 'raw-pages/page-problem-19-solution.html',
          },
          officialSolutions: {},
          officialSourceIds: {},
          userSourceIds: {
            cpp: ['evaluation-20058309'],
          },
          visibleTests: [],
          linkedAssets: [],
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/19/bfs',
          metadata: {
            authorHandle: 'Vasilut',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(snapshot.rawPagesRoot, 'page-https-www-pbinfo-ro-solutii-user-Vasilut-problema-19-bfs.html'),
      `
        <table class="table">
          <tbody>
            <tr>
              <td><a href="/profil/Vasilut">Vasilut Lucian (Vasilut)</a></td>
              <td><a href="/probleme/19/bfs">BFS</a></td>
              <td><a href="/detalii-evaluare/1492">Evaluare finalizată</a></td>
              <td>100</td>
            </tr>
          </tbody>
        </table>
      `,
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'official-source-list-19.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/solutii/user/Vasilut/problema/19/bfs',
        kind: 'official-source-list',
        httpStatus: 200,
        bodyPath: 'page-https-www-pbinfo-ro-solutii-user-Vasilut-problema-19-bfs.html',
        fetchedAt: '2026-03-18T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'statement-19.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-enunt.php?id=19',
        kind: 'problem-statement',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-19-statement.html',
        fetchedAt: '2026-03-18T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'solution-19.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-solutie.php?id=19',
        kind: 'problem-solution',
        httpStatus: 200,
        bodyPath: 'raw-pages/page-problem-19-solution.html',
        fetchedAt: '2026-03-18T00:00:00.000Z',
      }, null, 2),
      'utf8',
    );

    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-1492.json'),
      JSON.stringify(
        {
          evaluationId: 1492,
          problemId: 19,
          problemSlug: 'bfs',
          problemName: 'BFS',
          language: 'cpp',
          user: 'Vasilut Lucian (Vasilut)',
          score: 100,
          verdictSummary: '100 puncte',
          runtimeSeconds: 1,
          memoryKb: 128,
          sourceAvailable: false,
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-18T00:00:00.000Z',
          provenance: ['https://www.pbinfo.ro/detalii-evaluare/1492'],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'evaluation-20058309.json'),
      JSON.stringify(
        {
          evaluationId: 20058309,
          problemId: 19,
          problemSlug: 'bfs',
          problemName: 'BFS',
          language: 'cpp',
          user: 'Prekzursil',
          score: 100,
          verdictSummary: 'accepted',
          sourceAvailable: true,
          sourceCode: 'int main(){return 0;}',
          suspicionFlags: [],
          tests: [],
          fetchedAt: '2026-03-18T00:00:00.000Z',
          provenance: ['https://www.pbinfo.ro/detalii-evaluare/20058309'],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'sources', 'evaluation-20058309.json'),
      JSON.stringify(
        {
          sourceId: 'evaluation-20058309',
          kind: 'user-evaluation',
          problemId: 19,
          evaluationId: 20058309,
          userHandle: 'Prekzursil',
          language: 'cpp',
          score: 100,
          sourceAvailable: true,
          sourceCode: 'int main(){return 0;}',
          sourceHash: 'sha256:user',
          normalizedSourceHash: 'sha256:user-normalized',
          sourceLength: 21,
          fetchedAt: '2026-03-18T00:00:00.000Z',
          suspicionFlags: [],
          provenance: ['evaluation-detail'],
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
          entries: [
            {
              user: 'Prekzursil',
              problemId: 19,
              evaluationId: 20058309,
              score: 100,
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
          generatedAt: '2026-03-18T00:00:00.000Z',
          problems: [
            {
              problemId: 19,
              bestUserOverallEvaluationId: 20058309,
              bestUserPerLanguage: { cpp: 20058309 },
              bestTrustworthyOverallEvaluationId: 20058309,
              bestTrustworthyPerLanguage: { cpp: 20058309 },
              bestFastPerLanguage: { cpp: 20058309 },
              bestOfficialPerLanguage: {},
              suspiciousCandidateEvaluationIds: [],
              duplicateEvaluationIds: [],
              orderedUserEvaluationIds: [20058309],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await runProblemCoverageWorkflow(workspaceRoot, snapshot.snapshotId);

    const record = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'problem-coverage', 'problem-19.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(record).toEqual(
      expect.objectContaining({
        problemId: 19,
        officialSourceArchived: false,
        officialSourceStatus: 'not-available-upstream',
        archiveCompletenessStatus: 'incomplete',
      }),
    );
  });
});
