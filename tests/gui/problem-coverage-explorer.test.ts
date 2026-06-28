import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  getCoverageExplorerSummary,
  listCoverageExplorerRecords,
  readCoverageExplorerRecord,
} from '../../src/gui/main/problem-coverage-explorer.js';
import { buildProblemCoverageGapReport } from '../../src/coverage/coverage-gaps.js';
import type { ProblemCoverageIndex, ProblemCoverageRecord } from '../../src/types/records.js';
import { makeCoverageIndex, makeCoverageRecord } from '../_fixtures/coverage.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

function setupWorkspace(
  index: ProblemCoverageIndex,
  options: { withGapReport?: boolean; perProblemIds?: number[]; rankingIds?: number[] } = {},
): { workspace: string; normalizedRoot: string } {
  const workspace = mkdtempSync(join(tmpdir(), 'pbinfo-cov-explorer-'));
  tempDirs.push(workspace);
  const snapshotId = 'SNAP1';
  const norm = join(workspace, 'archive', 'snapshots', snapshotId, 'normalized');
  writeJson(join(workspace, 'archive', 'catalog.json'), {
    currentSnapshotId: snapshotId,
    canonicalSnapshotId: snapshotId,
    snapshots: [
      { snapshotId, createdAt: '2026-01-01T00:00:00.000Z', scope: 'all', status: 'completed', checkpoint: 'canonical' },
    ],
    artifactExports: [],
  });
  writeJson(join(norm, 'problem-coverage', 'index.json'), index);
  for (const id of options.perProblemIds ?? []) {
    const record = index.records.find((entry) => entry.problemId === id);
    if (record) {
      writeJson(join(norm, 'problem-coverage', `problem-${id}.json`), record);
    }
  }
  for (const id of options.rankingIds ?? []) {
    writeJson(join(norm, 'rankings', 'problems', `problem-${id}.json`), { problemId: id });
  }
  if (options.withGapReport) {
    buildProblemCoverageGapReport({
      normalizedRoot: norm,
      snapshotId,
      coverageIndex: index,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
  }
  return { workspace, normalizedRoot: norm };
}

function sparse(
  record: ProblemCoverageRecord,
  fields: Array<keyof ProblemCoverageRecord>,
): ProblemCoverageRecord {
  const copy = { ...record } as Partial<ProblemCoverageRecord>;
  for (const field of fields) {
    delete copy[field];
  }
  return copy as ProblemCoverageRecord;
}

const DERIVED_FIELDS: Array<keyof ProblemCoverageRecord> = [
  'officialSourceStatus',
  'testsCoverageStatus',
  'archiveCompletenessStatus',
  'officialSourceLanguages',
  'userSourceLanguages',
  'requiredTrustworthyUserSourceLanguages',
  'trustworthyUserSourceLanguages',
  'bestTrustworthyUserPerLanguage',
  'missingTrustworthyUserSourceLanguages',
  'testsAvailable',
  'unsolvedByConfiguredHandle',
  'officialSourceBlocked',
  'notArchivedYet',
  'newSinceBaseline',
  'effectiveTestsAvailableCount',
  'officialSourceIds',
  'userSourceIds',
];

function buildRichIndex(): ProblemCoverageIndex {
  const records: ProblemCoverageRecord[] = [
    makeCoverageRecord({
      problemId: 1,
      name: 'Alpha',
      tags: ['math'],
      solvedByMe: true,
      officialSourceArchived: true,
      userSourceArchived: true,
      testsFragmentArchived: true,
      visibleTestsCapturedCount: 2,
      exampleTestsAvailableCount: 1,
      effectiveTestsAvailableCount: 2,
      testsCoverageStatus: 'captured',
      officialSourceStatus: 'archived',
      editorialAvailability: 'visible',
      archiveCompletenessStatus: 'complete',
      rankingPresent: true,
      grade: 9,
    }),
    makeCoverageRecord({
      problemId: 2,
      name: 'Beta',
      solvedByMe: true,
      archiveCompletenessStatus: 'missing-user-source',
      missingTrustworthyUserSourceLanguages: ['cpp'],
      rankingPresent: true,
    }),
    makeCoverageRecord({
      problemId: 3,
      name: 'Gamma',
      solvedByMe: false,
      officialSourceStatus: 'not-available-upstream',
      testsCoverageStatus: 'not-captured-yet',
      archiveCompletenessStatus: 'missing-official-source',
      rankingPresent: false,
    }),
    makeCoverageRecord({
      problemId: 4,
      name: 'Delta',
      testsCoverageStatus: 'not-available-upstream',
      testsFragmentArchived: true,
      editorialAvailability: 'restricted',
      grade: 10,
    }),
    // Sparse records exercise every derive* branch.
    sparse(
      makeCoverageRecord({
        problemId: 11,
        solvedByMe: true,
        officialSourceArchived: true,
        userSourceArchived: true,
        visibleTestsCapturedCount: 1,
      }),
      DERIVED_FIELDS,
    ),
    sparse(
      makeCoverageRecord({
        problemId: 12,
        solvedByMe: false,
        officialSourceArchived: false,
        editorialAvailability: 'hidden',
        testsFragmentArchived: true,
      }),
      DERIVED_FIELDS,
    ),
    sparse(
      makeCoverageRecord({
        problemId: 13,
        officialSourceArchived: false,
        editorialAvailability: 'visible',
        sourceListUrl: undefined,
        testsFragmentArchived: false,
      }),
      [...DERIVED_FIELDS],
    ),
    sparse(
      makeCoverageRecord({
        problemId: 14,
        solvedByMe: true,
        userSourceArchived: false,
      }),
      DERIVED_FIELDS,
    ),
    sparse(
      makeCoverageRecord({
        problemId: 15,
        solvedByMe: true,
        userSourceArchived: true,
        officialSourceArchived: false,
        editorialAvailability: 'visible',
        sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/15/slug',
        visibleTestsCapturedCount: 1,
      }),
      DERIVED_FIELDS,
    ),
    sparse(
      makeCoverageRecord({
        problemId: 16,
        solvedByMe: true,
        userSourceArchived: true,
        officialSourceArchived: true,
        testsFragmentArchived: false,
      }),
      DERIVED_FIELDS,
    ),
    // Record with populated id arrays exercises the evaluation/source link maps.
    makeCoverageRecord({
      problemId: 17,
      evaluationIds: [123, 456],
      officialSourceIds: ['official-17-cpp'],
      userSourceIds: ['evaluation-17'],
      rankingPresent: true,
    }),
    // effective + visible counts absent -> falls through to example count.
    sparse(
      makeCoverageRecord({ problemId: 18, exampleTestsAvailableCount: 3 }),
      [...DERIVED_FIELDS, 'visibleTestsCapturedCount'],
    ),
    // all test counts and testsFragmentArchived absent -> zero / example>0 fallbacks.
    sparse(
      makeCoverageRecord({ problemId: 19 }),
      [
        ...DERIVED_FIELDS,
        'visibleTestsCapturedCount',
        'exampleTestsAvailableCount',
        'evaluationObservedTestsCount',
        'testsFragmentArchived',
      ],
    ),
    // missing trustworthy languages present but archive status derived -> short-circuit.
    sparse(
      makeCoverageRecord({
        problemId: 20,
        solvedByMe: true,
        missingTrustworthyUserSourceLanguages: ['cpp'],
      }),
      ['archiveCompletenessStatus'],
    ),
  ];
  // Record 13 must look not-archived-yet for the derive path; force the flag back.
  (records[6] as ProblemCoverageRecord).notArchivedYet = true;
  return makeCoverageIndex(records);
}

describe('problem-coverage-explorer summary', () => {
  test('aggregates derived status counts with a gap report present', () => {
    const { workspace } = setupWorkspace(buildRichIndex(), { withGapReport: true });
    const summary = getCoverageExplorerSummary(workspace);

    expect(summary.snapshotId).toBe('SNAP1');
    expect(summary.completeProblemCount).toBeGreaterThanOrEqual(1);
    expect((summary.unsolvedProblemIds ?? []).length).toBeGreaterThan(0);
    expect(Array.isArray(summary.missingOfficialSourceProblemIds)).toBe(true);
    expect(Array.isArray(summary.solvedByMeMissingUserSourceProblemIds)).toBe(true);
  });

  test('falls back to record-derived gap ids when no gap report exists', () => {
    const { workspace } = setupWorkspace(buildRichIndex(), { withGapReport: false });
    const summary = getCoverageExplorerSummary(workspace);
    expect(summary.unsolvedProblemIds).toContain(3);
    expect((summary.missingOfficialSourceProblemIds ?? []).length).toBeGreaterThan(0);
    expect(summary.solvedByMeMissingUserSourceProblemIds).toContain(2);
  });

  test('throws when coverage has not been generated', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pbinfo-cov-empty-'));
    tempDirs.push(workspace);
    writeJson(join(workspace, 'archive', 'catalog.json'), {
      currentSnapshotId: 'SNAP1',
      snapshots: [
        { snapshotId: 'SNAP1', createdAt: '2026-01-01T00:00:00.000Z', scope: 'all', status: 'completed', checkpoint: 'canonical' },
      ],
      artifactExports: [],
    });
    expect(() => getCoverageExplorerSummary(workspace)).toThrow(/has not been generated/);
  });
});

describe('problem-coverage-explorer listing', () => {
  test('applies the full filter matrix and pagination', () => {
    const { workspace } = setupWorkspace(buildRichIndex());

    expect(listCoverageExplorerRecords(workspace, { solved: 'solved' }).totalCount).toBeGreaterThan(0);
    expect(listCoverageExplorerRecords(workspace, { solved: 'unsolved' }).totalCount).toBeGreaterThan(0);
    listCoverageExplorerRecords(workspace, { testsFragmentArchived: 'yes' });
    listCoverageExplorerRecords(workspace, { testsFragmentArchived: 'no' });
    listCoverageExplorerRecords(workspace, { visibleTestsCaptured: 'yes' });
    listCoverageExplorerRecords(workspace, { visibleTestsCaptured: 'no' });
    listCoverageExplorerRecords(workspace, { testsCoverageStatus: 'all' });
    listCoverageExplorerRecords(workspace, { testsCoverageStatus: 'captured' });
    listCoverageExplorerRecords(workspace, { officialSourceArchived: 'yes' });
    listCoverageExplorerRecords(workspace, { officialSourceArchived: 'no' });
    listCoverageExplorerRecords(workspace, { userSourceArchived: 'yes' });
    listCoverageExplorerRecords(workspace, { userSourceArchived: 'no' });
    listCoverageExplorerRecords(workspace, { editorialAvailability: 'all' });
    listCoverageExplorerRecords(workspace, { editorialAvailability: 'visible' });
    listCoverageExplorerRecords(workspace, { grade: 9 });
    listCoverageExplorerRecords(workspace, { archiveCompletenessStatus: 'all' });
    listCoverageExplorerRecords(workspace, { archiveCompletenessStatus: 'complete' });

    const queried = listCoverageExplorerRecords(workspace, { query: 'alpha' });
    expect(queried.items.some((item) => item.problemId === 1)).toBe(true);

    const empty = listCoverageExplorerRecords(workspace, { query: 'no-such-problem' });
    expect(empty.totalCount).toBe(0);

    const paged = listCoverageExplorerRecords(workspace, { limit: 2, offset: 1 });
    expect(paged.items.length).toBeLessThanOrEqual(2);
    expect(paged.offset).toBe(1);
  });
});

describe('problem-coverage-explorer detail', () => {
  test('reads a record from its per-problem file with a ranking link', () => {
    const { workspace } = setupWorkspace(buildRichIndex(), {
      perProblemIds: [1],
      rankingIds: [1],
    });
    const detail = readCoverageExplorerRecord(workspace, { problemId: 1 });
    expect(detail.record.problemId).toBe(1);
    expect(detail.rawRecordLinks.rankingFilePath).toContain('problem-1.json');
    expect(detail.rawRecordLinks.evaluationFilePaths).toEqual([]);
  });

  test('falls back to the index when no per-problem file exists', () => {
    const { workspace } = setupWorkspace(buildRichIndex());
    const detail = readCoverageExplorerRecord(workspace, { problemId: 2 });
    expect(detail.record.problemId).toBe(2);
    // rankingPresent but no ranking file written -> no link.
    expect(detail.rawRecordLinks.rankingFilePath).toBeUndefined();
  });

  test('reads a sparse record and defaults missing id arrays', () => {
    const { workspace } = setupWorkspace(buildRichIndex());
    const detail = readCoverageExplorerRecord(workspace, { problemId: 16 });
    expect(detail.rawRecordLinks.officialSourceFilePaths).toEqual([]);
    expect(detail.rawRecordLinks.userSourceFilePaths).toEqual([]);
  });

  test('builds evaluation and source file links from populated id arrays', () => {
    const { workspace } = setupWorkspace(buildRichIndex());
    const detail = readCoverageExplorerRecord(workspace, { problemId: 17 });
    expect(detail.rawRecordLinks.evaluationFilePaths).toHaveLength(2);
    expect(detail.rawRecordLinks.officialSourceFilePaths[0]).toContain('official-17-cpp.json');
    expect(detail.rawRecordLinks.userSourceFilePaths[0]).toContain('evaluation-17.json');
  });

  test('throws when the record is missing', () => {
    const { workspace } = setupWorkspace(buildRichIndex());
    expect(() => readCoverageExplorerRecord(workspace, { problemId: 9999 })).toThrow(/was not found/);
  });
});
