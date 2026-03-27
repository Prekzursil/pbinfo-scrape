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
        problemsWithEffectiveTests: 2,
        problemsWithArchivedSources: 2,
        problemsWithOfficialSourceArchived: 2,
        problemsWithUserSourceArchived: 1,
        editorialVisibleCount: 1,
        rankingPresentCount: 2,
        newSinceBaselineCount: 0,
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
          effectiveTestsAvailableCount: 1,
          testsCoverageStatus: 'captured',
          officialSolutionPresent: true,
          editorialAvailability: 'hidden',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/sum',
          officialSourceArchived: false,
          officialSourceCount: 0,
          officialSourceIds: [],
          officialSourceLanguages: [],
          officialSourceStatus: 'restricted-upstream',
          userSourceArchived: false,
          userSourceCount: 0,
          userSourceIds: [],
          userSourceLanguages: [],
          requiredTrustworthyUserSourceLanguages: [],
          trustworthyUserSourceLanguages: [],
          bestTrustworthyUserPerLanguage: {},
          missingTrustworthyUserSourceLanguages: [],
          archiveCompletenessStatus: 'unsolved',
          hasAnyArchivedSource: false,
          testsAvailable: true,
          unsolvedByConfiguredHandle: true,
          officialSourceBlocked: true,
          officialSourceBlockedReason: 'editorial-hidden',
          notArchivedYet: false,
          newSinceBaseline: false,
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
          effectiveTestsAvailableCount: 2,
          testsCoverageStatus: 'captured',
          officialSolutionPresent: true,
          editorialAvailability: 'visible',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/205/shuffle',
          officialSourceArchived: true,
          officialSourceCount: 1,
          officialSourceIds: ['official-205-cpp'],
          officialSourceLanguages: ['cpp'],
          officialSourceStatus: 'archived',
          userSourceArchived: false,
          userSourceCount: 0,
          userSourceIds: [],
          userSourceLanguages: [],
          requiredTrustworthyUserSourceLanguages: ['cpp'],
          trustworthyUserSourceLanguages: [],
          bestTrustworthyUserPerLanguage: {},
          missingTrustworthyUserSourceLanguages: ['cpp'],
          archiveCompletenessStatus: 'missing-user-source',
          hasAnyArchivedSource: true,
          testsAvailable: true,
          unsolvedByConfiguredHandle: false,
          officialSourceBlocked: false,
          notArchivedYet: false,
          newSinceBaseline: false,
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
          effectiveTestsAvailableCount: 0,
          testsCoverageStatus: 'not-available-upstream',
          officialSolutionPresent: false,
          editorialAvailability: 'unknown',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/3171/waterreserve',
          officialSourceArchived: true,
          officialSourceCount: 1,
          officialSourceIds: ['official-3171-cpp'],
          officialSourceLanguages: ['cpp'],
          officialSourceStatus: 'archived',
          userSourceArchived: true,
          userSourceCount: 1,
          userSourceIds: ['evaluation-63332367'],
          userSourceLanguages: ['cpp'],
          requiredTrustworthyUserSourceLanguages: ['cpp'],
          trustworthyUserSourceLanguages: ['cpp'],
          bestTrustworthyUserPerLanguage: {
            cpp: 63332367,
          },
          missingTrustworthyUserSourceLanguages: [],
          archiveCompletenessStatus: 'complete',
          hasAnyArchivedSource: true,
          testsAvailable: false,
          unsolvedByConfiguredHandle: false,
          officialSourceBlocked: false,
          notArchivedYet: false,
          newSinceBaseline: false,
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

    expect(report.totals).toEqual(
      expect.objectContaining({
        totalProblems: 3,
        solvedByMeCount: 2,
        unsolvedCount: 1,
        missingOfficialSourceCount: 1,
        solvedByMeMissingUserSourceCount: 1,
        noTestsCount: 1,
        exampleOnlyCount: 1,
        visibleTestsPresentCount: 1,
      }),
    );
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
        missingTrustworthyUserSourceLanguages: ['cpp'],
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

  test('fails the official-source hard gate when source capture is still missing despite visible upstream solution surfaces', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-gaps-official-hard-fail-'));
    tempDirs.push(workspaceRoot);
    const normalizedRoot = join(workspaceRoot, 'normalized');

    const coverageIndex: ProblemCoverageIndex = {
      snapshotId: 'candidate-20260316-2141',
      generatedAt: '2026-03-16T21:41:00.000Z',
      totals: {
        totalProblems: 1,
        solvedByMeCount: 0,
        statementArchivedCount: 1,
        solutionFragmentArchivedCount: 1,
        testsFragmentArchivedCount: 1,
        problemsWithExamples: 1,
        problemsWithVisibleTestsCaptured: 0,
        problemsWithEvaluationObservedTests: 0,
        problemsWithEffectiveTests: 1,
        problemsWithArchivedSources: 0,
        problemsWithOfficialSourceArchived: 0,
        problemsWithUserSourceArchived: 0,
        editorialVisibleCount: 1,
        rankingPresentCount: 0,
        newSinceBaselineCount: 1,
      },
      records: [
        {
          snapshotId: 'candidate-20260316-2141',
          problemId: 3171,
          slug: 'waterreserve',
          name: 'WaterReserve',
          grade: 9,
          canonicalUrl: 'https://www.pbinfo.ro/probleme/3171/waterreserve',
          mirrorRoute: '/probleme/3171/waterreserve',
          tags: ['array'],
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
          testsCoverageStatus: 'captured',
          officialSolutionPresent: true,
          editorialAvailability: 'visible',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/3171/waterreserve',
          officialSourceArchived: false,
          officialSourceCount: 0,
          officialSourceIds: [],
          officialSourceLanguages: [],
          officialSourceStatus: 'not-captured-yet',
          userSourceArchived: false,
          userSourceCount: 0,
          userSourceIds: [],
          userSourceLanguages: [],
          requiredTrustworthyUserSourceLanguages: [],
          trustworthyUserSourceLanguages: [],
          bestTrustworthyUserPerLanguage: {},
          missingTrustworthyUserSourceLanguages: [],
          archiveCompletenessStatus: 'unsolved',
          hasAnyArchivedSource: false,
          testsAvailable: true,
          unsolvedByConfiguredHandle: true,
          officialSourceBlocked: true,
          officialSourceBlockedReason: 'official-source-not-captured',
          notArchivedYet: false,
          newSinceBaseline: true,
          evaluationIds: [],
          notes: [
            'Editorial/solution fragment archived, but official source code is not archived yet.',
            'Community source list exists upstream, but it is not counted as archived official source code.',
          ],
        },
      ],
    };

    const report = buildProblemCoverageGapReport({
      normalizedRoot,
      snapshotId: coverageIndex.snapshotId,
      coverageIndex,
      now: new Date('2026-03-16T22:00:00.000Z'),
    });

    expect(report.missingOfficialSources).toEqual([
      expect.objectContaining({
        problemId: 3171,
        blockedReason: 'official-source-not-captured',
      }),
    ]);
    expect(report.gates.officialSourceGate).toEqual({
      passed: false,
      failedProblemIds: [3171],
      failureCount: 1,
    });
  });

  test('does not fail the official-source hard gate when official harvest completed but no source body is available upstream', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-gaps-official-unavailable-'));
    tempDirs.push(workspaceRoot);
    const normalizedRoot = join(workspaceRoot, 'normalized');

    const coverageIndex: ProblemCoverageIndex = {
      snapshotId: 'candidate-official-unavailable',
      generatedAt: '2026-03-27T16:30:00.000Z',
      totals: {
        totalProblems: 1,
        solvedByMeCount: 1,
        statementArchivedCount: 1,
        solutionFragmentArchivedCount: 1,
        testsFragmentArchivedCount: 1,
        problemsWithExamples: 0,
        problemsWithVisibleTestsCaptured: 0,
        problemsWithEvaluationObservedTests: 1,
        problemsWithEffectiveTests: 1,
        problemsWithArchivedSources: 1,
        problemsWithOfficialSourceArchived: 0,
        problemsWithUserSourceArchived: 1,
        editorialVisibleCount: 1,
        rankingPresentCount: 1,
        newSinceBaselineCount: 1,
      },
      records: [
        {
          snapshotId: 'candidate-official-unavailable',
          problemId: 19,
          slug: 'bfs',
          name: 'BFS',
          grade: 11,
          canonicalUrl: 'https://www.pbinfo.ro/probleme/19/bfs',
          mirrorRoute: '/probleme/19/bfs',
          tags: [],
          solvedByMe: true,
          evaluationCount: 2,
          solvedEvaluationCount: 1,
          rankingPresent: true,
          statementArchived: true,
          solutionFragmentArchived: true,
          testsFragmentArchived: true,
          exampleTestsAvailableCount: 0,
          visibleTestsCapturedCount: 0,
          evaluationObservedTestsCount: 1,
          effectiveTestsAvailableCount: 1,
          testsCoverageStatus: 'captured',
          officialSolutionPresent: true,
          editorialAvailability: 'visible',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/19/bfs',
          officialSourceArchived: false,
          officialSourceCount: 0,
          officialSourceIds: [],
          officialSourceLanguages: [],
          officialSourceStatus: 'not-available-upstream',
          userSourceArchived: true,
          userSourceCount: 1,
          userSourceIds: ['evaluation-20058309'],
          userSourceLanguages: ['cpp'],
          requiredTrustworthyUserSourceLanguages: ['cpp'],
          trustworthyUserSourceLanguages: ['cpp'],
          bestTrustworthyUserPerLanguage: { cpp: 20058309 },
          missingTrustworthyUserSourceLanguages: [],
          archiveCompletenessStatus: 'complete',
          hasAnyArchivedSource: true,
          testsAvailable: true,
          unsolvedByConfiguredHandle: false,
          officialSourceBlocked: false,
          officialSourceBlockedReason: 'not-available-upstream',
          notArchivedYet: false,
          newSinceBaseline: true,
          evaluationIds: [20058309, 1492],
          bestUserOverallEvaluationId: 20058309,
          notes: [
            'Official source list harvested, but the qualifying official evaluation exposes no source body upstream.',
          ],
        },
      ],
    };

    const report = buildProblemCoverageGapReport({
      normalizedRoot,
      snapshotId: coverageIndex.snapshotId,
      coverageIndex,
      now: new Date('2026-03-27T16:31:00.000Z'),
    });

    expect(report.gates.officialSourceGate).toEqual({
      passed: true,
      failedProblemIds: [],
      failureCount: 0,
    });
  });
});
