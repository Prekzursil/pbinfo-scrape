import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  buildProblemCoverageGapReport,
  readProblemCoverageGapReport,
} from '../../src/coverage/coverage-gaps.js';
import type { ProblemCoverageRecord } from '../../src/types/records.js';
import { makeCoverageIndex, makeCoverageRecord } from '../_fixtures/coverage.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-gaps-edges-'));
  tempDirs.push(root);
  return root;
}

describe('coverage-gaps edge cases', () => {
  test('derives every blocked reason when the record omits an explicit reason', () => {
    const normalizedRoot = join(tempRoot(), 'normalized');
    const records: ProblemCoverageRecord[] = [
      makeCoverageRecord({ problemId: 1, editorialAvailability: 'hidden' }),
      makeCoverageRecord({ problemId: 2, editorialAvailability: 'restricted' }),
      makeCoverageRecord({
        problemId: 3,
        editorialAvailability: 'visible',
        officialSourceStatus: 'not-available-upstream',
      }),
      makeCoverageRecord({
        problemId: 4,
        editorialAvailability: 'visible',
        officialSourceStatus: 'not-captured-yet',
        solutionFragmentArchived: false,
      }),
      makeCoverageRecord({
        problemId: 5,
        editorialAvailability: 'visible',
        officialSourceStatus: 'not-captured-yet',
        solutionFragmentArchived: true,
        officialSolutionPresent: true,
      }),
    ];

    const report = buildProblemCoverageGapReport({
      normalizedRoot,
      snapshotId: 'SNAP',
      coverageIndex: makeCoverageIndex(records),
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    const byId = Object.fromEntries(
      report.missingOfficialSources.map((entry) => [entry.problemId, entry.blockedReason]),
    );
    expect(byId).toEqual({
      1: 'editorial-hidden',
      2: 'editorial-restricted',
      3: 'not-available-upstream',
      4: 'solution-fragment-not-archived',
      5: 'official-source-not-captured',
    });
  });

  test('treats a solved record missing the trustworthy-languages field as a user-source gap', () => {
    const normalizedRoot = join(tempRoot(), 'normalized');
    const record = makeCoverageRecord({
      problemId: 7,
      solvedByMe: true,
      userSourceArchived: false,
      officialSourceArchived: true,
    });
    // Remove the optional field entirely to exercise the `in` operator branch.
    delete (record as Partial<ProblemCoverageRecord>).missingTrustworthyUserSourceLanguages;

    const report = buildProblemCoverageGapReport({
      normalizedRoot,
      snapshotId: 'SNAP',
      coverageIndex: makeCoverageIndex([record]),
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(report.solvedByMeMissingUserSource.map((entry) => entry.problemId)).toEqual([7]);
  });

  test('falls back to test counts when testsAvailable is undefined', () => {
    const normalizedRoot = join(tempRoot(), 'normalized');
    const withTests = makeCoverageRecord({ problemId: 10, exampleTestsAvailableCount: 2 });
    const withoutTests = makeCoverageRecord({ problemId: 11 });
    for (const record of [withTests, withoutTests]) {
      delete (record as Partial<ProblemCoverageRecord>).testsAvailable;
    }

    const report = buildProblemCoverageGapReport({
      normalizedRoot,
      snapshotId: 'SNAP',
      coverageIndex: makeCoverageIndex([withTests, withoutTests]),
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(report.noTestsProblemIds).toEqual([11]);
  });

  test('uses current time and field fallbacks when optional inputs are absent', () => {
    const normalizedRoot = join(tempRoot(), 'normalized');
    const record = makeCoverageRecord({ problemId: 21, editorialAvailability: 'hidden' });
    // Strip optional evidence fields to exercise the `?? default` fallbacks.
    const stripped = record as Partial<ProblemCoverageRecord>;
    delete stripped.testsCoverageStatus;
    delete stripped.officialSourceStatus;
    delete stripped.officialSourceLanguages;
    delete stripped.userSourceLanguages;
    delete stripped.requiredTrustworthyUserSourceLanguages;
    delete stripped.trustworthyUserSourceLanguages;
    delete stripped.bestTrustworthyUserPerLanguage;
    delete stripped.archiveCompletenessStatus;

    // No `now` provided -> the `?? new Date()` fallback is exercised.
    const report = buildProblemCoverageGapReport({
      normalizedRoot,
      snapshotId: 'SNAP',
      coverageIndex: makeCoverageIndex([record]),
    });

    const entry = report.missingOfficialSources[0];
    expect(entry?.evidence.testsCoverageStatus).toBe('not-captured-yet');
    expect(entry?.evidence.officialSourceStatus).toBe('not-captured-yet');
    expect(entry?.evidence.officialSourceLanguages).toEqual([]);
    expect(entry?.evidence.archiveCompletenessStatus).toBe('incomplete');
    expect(Date.parse(report.generatedAt)).not.toBeNaN();
  });

  test('readProblemCoverageGapReport returns undefined when the report is missing', () => {
    const normalizedRoot = join(tempRoot(), 'normalized');
    expect(readProblemCoverageGapReport(normalizedRoot)).toBeUndefined();
  });

  test('readProblemCoverageGapReport reads a valid report and tolerates corruption', () => {
    const normalizedRoot = join(tempRoot(), 'normalized');
    buildProblemCoverageGapReport({
      normalizedRoot,
      snapshotId: 'SNAP',
      coverageIndex: makeCoverageIndex([makeCoverageRecord({ problemId: 1 })]),
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    const loaded = readProblemCoverageGapReport(normalizedRoot);
    expect(loaded?.snapshotId).toBe('SNAP');

    writeFileSync(join(normalizedRoot, 'problem-coverage', 'gaps.json'), '{ broken', 'utf8');
    expect(readProblemCoverageGapReport(normalizedRoot)).toBeUndefined();
    mkdirSync(normalizedRoot, { recursive: true });
  });
});
