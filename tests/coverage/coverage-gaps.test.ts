import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { buildProblemCoverageGapReport } from '../../src/coverage/coverage-gaps.js';
import type { ProblemCoverageIndex } from '../../src/types/records.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('problem coverage gap report', () => {
  test('derives unsolved, missing-official, and solved-user-source gaps with hard gate status', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-gaps-'));
    tempDirs.push(workspaceRoot);
    const normalizedRoot = join(workspaceRoot, 'normalized');

    const coverageIndex: ProblemCoverageIndex = {
      snapshotId: 'candidate-20260315-1405',
      generatedAt: '2026-03-15T14:05:00.000Z',
      totals: {
        totalProblems: 3,
        solvedByMeCount: 2,
        statementArchivedCount: 3,
        solutionFragmentArchivedCount: 2,
        testsFragmentArchivedCount: 3,
        problemsWithExamples: 2,
        problemsWithVisibleTestsCaptured: 1,
        problemsWithEvaluationObservedTests: 1,
        problemsWithArchivedSources: 2,
        problemsWithOfficialSourceArchived: 2,
        problemsWithUserSourceArchived: 1,
        editorialVisibleCount: 1,
        rankingPresentCount: 2,
      },
      records: [
        {
          snapshotId: 'candidate-20260315-1405',
          problemId: 1,
          slug: 'sum',
          name: 'Sum',
          grade: 5,
          canonicalUrl: 'https://www.pbinfo.ro/probleme/1/sum',
          mirrorRoute: '/probleme/1/sum',
          tags: ['intro'],
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
          officialSourceIds: [],
          userSourceArchived: false,
          userSourceCount: 0,
          userSourceIds: [],
          hasAnyArchivedSource: false,
          evaluationIds: [],
          notes: ['Source list available upstream, no archived source code yet.'],
        },
        {
          snapshotId: 'candidate-20260315-1405',
          problemId: 205,
          slug: 'shuffle',
          name: 'Shuffle',
          grade: 10,
          canonicalUrl: 'https://www.pbinfo.ro/probleme/205/shuffle',
          mirrorRoute: '/probleme/205/shuffle',
          tags: ['sort'],
          solvedByMe: true,
          evaluationCount: 2,
          solvedEvaluationCount: 2,
          rankingPresent: true,
          statementArchived: true,
          solutionFragmentArchived: true,
          testsFragmentArchived: true,
          exampleTestsAvailableCount: 1,
          visibleTestsCapturedCount: 1,
          evaluationObservedTestsCount: 1,
          officialSolutionPresent: true,
          editorialAvailability: 'visible',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/205/shuffle',
          officialSourceArchived: true,
          officialSourceCount: 1,
          officialSourceIds: ['official-205-cpp'],
          userSourceArchived: false,
          userSourceCount: 0,
          userSourceIds: [],
          hasAnyArchivedSource: true,
          evaluationIds: [70000001, 70000002],
          bestUserOverallEvaluationId: 70000002,
          notes: [],
        },
        {
          snapshotId: 'candidate-20260315-1405',
          problemId: 3171,
          slug: 'waterreserve',
          name: 'WaterReserve',
          grade: 9,
          canonicalUrl: 'https://www.pbinfo.ro/probleme/3171/waterreserve',
          mirrorRoute: '/probleme/3171/waterreserve',
          tags: ['array'],
          solvedByMe: true,
          evaluationCount: 1,
          solvedEvaluationCount: 1,
          rankingPresent: true,
          statementArchived: true,
          solutionFragmentArchived: false,
          testsFragmentArchived: true,
          exampleTestsAvailableCount: 0,
          visibleTestsCapturedCount: 0,
          evaluationObservedTestsCount: 0,
          officialSolutionPresent: false,
          editorialAvailability: 'unknown',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/3171/waterreserve',
          officialSourceArchived: true,
          officialSourceCount: 1,
          officialSourceIds: ['official-3171-cpp'],
          userSourceArchived: true,
          userSourceCount: 1,
          userSourceIds: ['evaluation-63332367'],
          hasAnyArchivedSource: true,
          evaluationIds: [63332367],
          bestUserOverallEvaluationId: 63332367,
          notes: [],
        },
      ],
    };

    const report = buildProblemCoverageGapReport({
      normalizedRoot,
      snapshotId: coverageIndex.snapshotId,
      coverageIndex,
      now: new Date('2026-03-15T16:00:00.000Z'),
    });

    expect(report.totals).toEqual({
      totalProblems: 3,
      solvedByMeCount: 2,
      unsolvedCount: 1,
      missingOfficialSourceCount: 1,
      solvedByMeMissingUserSourceCount: 1,
    });
    expect(report.unsolvedProblemIds).toEqual([1]);
    expect(report.missingOfficialSources).toEqual([
      expect.objectContaining({
        problemId: 1,
        blockedReason: 'editorial-hidden',
      }),
    ]);
    expect(report.solvedByMeMissingUserSource).toEqual([
      expect.objectContaining({
        problemId: 205,
      }),
    ]);
    expect(report.gates.officialSourceGate).toEqual({
      passed: true,
      failedProblemIds: [],
      failureCount: 0,
    });
    expect(report.gates.solvedUserSourceGate).toEqual({
      passed: false,
      failedProblemIds: [205],
      failureCount: 1,
    });

    expect(existsSync(report.paths.reportPath)).toBe(true);
    expect(existsSync(report.paths.unsolvedPath)).toBe(true);
    expect(existsSync(report.paths.missingOfficialPath)).toBe(true);
    expect(existsSync(report.paths.missingSolvedUserSourcePath)).toBe(true);

    const persisted = JSON.parse(readFileSync(report.paths.reportPath, 'utf8')) as {
      snapshotId: string;
      gates: { solvedUserSourceGate: { passed: boolean } };
    };
    expect(persisted.snapshotId).toBe('candidate-20260315-1405');
    expect(persisted.gates.solvedUserSourceGate.passed).toBe(false);
  });
});
