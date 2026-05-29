import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  buildProblemCoverageGapReport,
  readProblemCoverageGapReport,
} from '../../src/coverage/coverage-gaps.js';
import type { ProblemCoverageIndex, ProblemCoverageRecord } from '../../src/types/records.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeCoverageRecord(overrides: Partial<ProblemCoverageRecord>): ProblemCoverageRecord {
  return {
    snapshotId: 'derive-snapshot',
    problemId: 1,
    slug: 'p',
    name: 'P',
    grade: 9,
    canonicalUrl: 'https://www.pbinfo.ro/probleme/1/p',
    mirrorRoute: '/probleme/1/p',
    tags: [],
    solvedByMe: false,
    evaluationCount: 0,
    solvedEvaluationCount: 0,
    rankingPresent: false,
    statementArchived: true,
    solutionFragmentArchived: true,
    testsFragmentArchived: true,
    exampleTestsAvailableCount: 0,
    visibleTestsCapturedCount: 0,
    evaluationObservedTestsCount: 0,
    effectiveTestsAvailableCount: 0,
    testsCoverageStatus: 'not-captured-yet',
    officialSolutionPresent: false,
    editorialAvailability: 'unknown',
    sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/p',
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
    testsAvailable: false,
    unsolvedByConfiguredHandle: true,
    officialSourceBlocked: true,
    notArchivedYet: false,
    newSinceBaseline: false,
    evaluationIds: [],
    notes: [],
    ...overrides,
  };
}

describe('coverage-gaps readProblemCoverageGapReport', () => {
  test('returns undefined when gaps.json is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-cov-gap-missing-'));
    tempDirs.push(root);
    expect(readProblemCoverageGapReport(root)).toBeUndefined();
  });

  test('returns undefined when gaps.json is malformed JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-cov-gap-malformed-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'problem-coverage'), { recursive: true });
    writeFileSync(join(root, 'problem-coverage', 'gaps.json'), 'not valid json', 'utf8');
    expect(readProblemCoverageGapReport(root)).toBeUndefined();
  });

  test('parses a valid gaps.json file when present', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-cov-gap-valid-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'problem-coverage'), { recursive: true });
    const payload = { snapshotId: 'x', generatedAt: 't', gates: {} } as Record<string, unknown>;
    writeFileSync(join(root, 'problem-coverage', 'gaps.json'), JSON.stringify(payload), 'utf8');
    expect(readProblemCoverageGapReport(root)).toEqual(payload);
  });
});

describe('coverage-gaps hasAnyGapTestCount fallback', () => {
  test('uses count-based fallback when testsAvailable is undefined', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-cov-gap-fallback-'));
    tempDirs.push(root);
    const normalizedRoot = join(root, 'normalized');

    const recordWithCounts = makeCoverageRecord({
      problemId: 101,
      solvedByMe: true,
      testsAvailable: undefined as never,
      effectiveTestsAvailableCount: 5,
    });
    const recordNoCounts = makeCoverageRecord({
      problemId: 102,
      solvedByMe: false,
      testsAvailable: undefined as never,
    });

    const coverageIndex: ProblemCoverageIndex = {
      snapshotId: 'fb-snapshot',
      generatedAt: '2026-03-15T14:05:00.000Z',
      totals: {
        totalProblems: 2,
        solvedByMeCount: 1,
        statementArchivedCount: 0,
        solutionFragmentArchivedCount: 0,
        testsFragmentArchivedCount: 0,
        problemsWithExamples: 0,
        problemsWithVisibleTestsCaptured: 0,
        problemsWithEvaluationObservedTests: 0,
        problemsWithEffectiveTests: 1,
        problemsWithArchivedSources: 0,
        problemsWithOfficialSourceArchived: 0,
        problemsWithUserSourceArchived: 0,
        editorialVisibleCount: 0,
        rankingPresentCount: 0,
        completeProblemCount: 0,
        incompleteSolvedProblemCount: 0,
        missingOfficialSourceCaptureCount: 0,
        officialSourceUnavailableUpstreamCount: 0,
        missingTestsCaptureCount: 0,
        testsUnavailableUpstreamCount: 0,
        newSinceBaselineCount: 0,
      },
      records: [recordWithCounts, recordNoCounts],
    };

    const report = buildProblemCoverageGapReport({
      coverageIndex,
      normalizedRoot,
      generatedAt: '2026-03-15T14:06:00.000Z',
    });
    // Record 102 should appear in noTests because hasAnyGapTestCount is false.
    expect(report.noTestsProblemIds).toContain(102);
    // Record 101 should NOT appear (counts > 0 -> testsAvailable=true via fallback).
    expect(report.noTestsProblemIds).not.toContain(101);
  });
});

describe('coverage-gaps deriveOfficialBlockedReason solution-fragment fallback', () => {
  test('falls back to official-source-not-captured when solutionFragmentArchived without other reasons', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-cov-gap-blocked-'));
    tempDirs.push(root);
    const normalizedRoot = join(root, 'normalized');

    const record = makeCoverageRecord({
      problemId: 201,
      solvedByMe: true,
      officialSourceArchived: false,
      editorialAvailability: 'visible',
      officialSourceStatus: 'not-captured-yet',
      solutionFragmentArchived: true,
      officialSolutionPresent: true,
      officialSourceBlocked: true,
    });

    const coverageIndex: ProblemCoverageIndex = {
      snapshotId: 'br-snapshot',
      generatedAt: '2026-03-15T14:05:00.000Z',
      totals: {
        totalProblems: 1,
        solvedByMeCount: 1,
        statementArchivedCount: 1,
        solutionFragmentArchivedCount: 1,
        testsFragmentArchivedCount: 0,
        problemsWithExamples: 0,
        problemsWithVisibleTestsCaptured: 0,
        problemsWithEvaluationObservedTests: 0,
        problemsWithEffectiveTests: 0,
        problemsWithArchivedSources: 0,
        problemsWithOfficialSourceArchived: 0,
        problemsWithUserSourceArchived: 0,
        editorialVisibleCount: 1,
        rankingPresentCount: 0,
        completeProblemCount: 0,
        incompleteSolvedProblemCount: 1,
        missingOfficialSourceCaptureCount: 1,
        officialSourceUnavailableUpstreamCount: 0,
        missingTestsCaptureCount: 0,
        testsUnavailableUpstreamCount: 0,
        newSinceBaselineCount: 0,
      },
      records: [record],
    };

    const report = buildProblemCoverageGapReport({
      coverageIndex,
      normalizedRoot,
      generatedAt: '2026-03-15T14:06:00.000Z',
    });
    const officialGap = report.missingOfficialSources.find(
      (entry) => entry.problemId === 201,
    );
    expect(officialGap?.blockedReason).toBeDefined();
  });
});
