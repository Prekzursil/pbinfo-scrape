import { describe, expect, test } from 'vitest';

import {
  collectTags,
  listProblems,
  mapCoverageRecordToRow,
  type ProblemRowInput,
} from '../../../src/gui/main/library-repository.js';
import { DEFAULT_FILTERS } from '../../../src/gui/renderer/library-shell/useFilters.js';
import type { ProblemCoverageRecord } from '../../../src/types/records.js';

function makeRow(overrides: Partial<ProblemRowInput>): ProblemRowInput {
  return {
    id: '100',
    name: 'notwen',
    slug: 'notwen',
    grade: 9,
    tags: ['matematica', 'simulare'],
    progress: 'solved',
    bestScore: 100,
    completeness: 'complete',
    pillars: {
      statement: 'captured',
      editorial: 'captured',
      officialSource: 'captured',
      mySource: 'captured',
      tests: 'captured',
    },
    languagesTried: ['cpp'],
    ...overrides,
  };
}

const fixture: ProblemRowInput[] = [
  makeRow({ id: '100', name: 'notwen', grade: 9, tags: ['matematica', 'simulare'] }),
  makeRow({
    id: '200',
    name: 'suma',
    slug: 'suma',
    grade: 5,
    tags: ['aritmetica'],
    progress: 'not-attempted',
    bestScore: 0,
    completeness: 'never-crawled',
    pillars: {
      statement: 'missing',
      editorial: 'missing',
      officialSource: 'missing',
      mySource: 'not-applicable',
      tests: 'missing',
    },
    languagesTried: [],
  }),
  makeRow({
    id: '300',
    name: 'fibo',
    slug: 'fibo',
    grade: 11,
    tags: ['dinamica'],
    progress: 'partial',
    bestScore: 60,
    completeness: 'incomplete-my-gap',
    pillars: {
      statement: 'captured',
      editorial: 'captured',
      officialSource: 'restricted',
      mySource: 'not-applicable',
      tests: 'captured',
    },
    languagesTried: ['py'],
  }),
];

describe('listProblems', () => {
  test('returns all rows sorted by id asc by default', () => {
    const result = listProblems({
      rows: fixture,
      filters: DEFAULT_FILTERS,
      sort: { key: 'id', dir: 'asc' },
      limit: 50,
      offset: 0,
    });
    expect(result.totalCount).toBe(3);
    expect(result.rows.map((r) => r.id)).toEqual(['100', '200', '300']);
  });

  test('search is case-insensitive across id / name / slug / tags', () => {
    const result = listProblems({
      rows: fixture,
      filters: { ...DEFAULT_FILTERS, search: 'DINAMICA' },
      sort: { key: 'id', dir: 'asc' },
      limit: 50,
      offset: 0,
    });
    expect(result.rows.map((r) => r.id)).toEqual(['300']);
  });

  test('grades filter includes only matching rows', () => {
    const result = listProblems({
      rows: fixture,
      filters: { ...DEFAULT_FILTERS, grades: [9, 11] },
      sort: { key: 'id', dir: 'asc' },
      limit: 50,
      offset: 0,
    });
    expect(result.rows.map((r) => r.id)).toEqual(['100', '300']);
  });

  test('completeness filter narrows to incomplete-my-gap', () => {
    const result = listProblems({
      rows: fixture,
      filters: { ...DEFAULT_FILTERS, completeness: 'incomplete-my-gap' },
      sort: { key: 'id', dir: 'asc' },
      limit: 50,
      offset: 0,
    });
    expect(result.rows.map((r) => r.id)).toEqual(['300']);
  });

  test('pagination respects limit + offset', () => {
    const result = listProblems({
      rows: fixture,
      filters: DEFAULT_FILTERS,
      sort: { key: 'id', dir: 'asc' },
      limit: 1,
      offset: 1,
    });
    expect(result.totalCount).toBe(3);
    expect(result.rows.map((r) => r.id)).toEqual(['200']);
  });

  test('sort by bestScore desc', () => {
    const result = listProblems({
      rows: fixture,
      filters: DEFAULT_FILTERS,
      sort: { key: 'bestScore', dir: 'desc' },
      limit: 50,
      offset: 0,
    });
    expect(result.rows.map((r) => r.id)).toEqual(['100', '300', '200']);
  });

  test('officialSource=restricted filter narrows correctly', () => {
    const result = listProblems({
      rows: fixture,
      filters: { ...DEFAULT_FILTERS, officialSource: 'restricted' },
      sort: { key: 'id', dir: 'asc' },
      limit: 50,
      offset: 0,
    });
    expect(result.rows.map((r) => r.id)).toEqual(['300']);
  });
});

describe('collectTags', () => {
  test('returns unique tags sorted alphabetically', () => {
    expect(collectTags(fixture)).toEqual([
      'aritmetica',
      'dinamica',
      'matematica',
      'simulare',
    ]);
  });

  test('returns empty array for no rows', () => {
    expect(collectTags([])).toEqual([]);
  });
});

describe('mapCoverageRecordToRow', () => {
  const baseRecord: ProblemCoverageRecord = {
    snapshotId: 'snap-1',
    problemId: 100,
    slug: 'notwen',
    name: 'notwen',
    grade: 9,
    mirrorRoute: '/probleme/100',
    tags: ['matematica'],
    solvedByMe: true,
    evaluationCount: 5,
    solvedEvaluationCount: 2,
    rankingPresent: true,
    statementArchived: true,
    solutionFragmentArchived: true,
    testsFragmentArchived: true,
    exampleTestsAvailableCount: 1,
    visibleTestsCapturedCount: 1,
    evaluationObservedTestsCount: 1,
    effectiveTestsAvailableCount: 1,
    testsCoverageStatus: 'captured',
    officialSolutionPresent: true,
    editorialAvailability: 'visible',
    officialSourceArchived: true,
    officialSourceCount: 1,
    officialSourceIds: ['off-1'],
    officialSourceLanguages: ['cpp'],
    officialSourceStatus: 'archived',
    userSourceArchived: true,
    userSourceCount: 1,
    userSourceIds: ['src-1'],
    userSourceLanguages: ['cpp'],
    requiredTrustworthyUserSourceLanguages: ['cpp'],
    trustworthyUserSourceLanguages: ['cpp'],
    bestTrustworthyUserPerLanguage: { cpp: 100 },
    missingTrustworthyUserSourceLanguages: [],
    archiveCompletenessStatus: 'complete',
    hasAnyArchivedSource: true,
    testsAvailable: true,
    unsolvedByConfiguredHandle: false,
    officialSourceBlocked: false,
    notArchivedYet: false,
    newSinceBaseline: false,
    evaluationIds: [1, 2, 3],
    notes: [],
    progressState: 'solved',
    bestScore: 100,
    languagesTried: ['cpp'],
  };

  test('maps solved + fully archived record to captured pillars', () => {
    const row = mapCoverageRecordToRow(baseRecord);
    expect(row.id).toBe('100');
    expect(row.progress).toBe('solved');
    expect(row.bestScore).toBe(100);
    expect(row.pillars.statement).toBe('captured');
    expect(row.pillars.editorial).toBe('captured');
    expect(row.pillars.officialSource).toBe('captured');
    expect(row.pillars.mySource).toBe('captured');
    expect(row.pillars.tests).toBe('captured');
    expect(row.completeness).toBe('complete');
  });

  test('maps restricted editorial to restricted pillar', () => {
    const row = mapCoverageRecordToRow({
      ...baseRecord,
      editorialAvailability: 'restricted',
    });
    expect(row.pillars.editorial).toBe('restricted');
  });

  test('maps not-archived-yet status to never-crawled completeness', () => {
    const row = mapCoverageRecordToRow({
      ...baseRecord,
      archiveCompletenessStatus: 'not-archived-yet',
      statementArchived: false,
      solutionFragmentArchived: false,
      testsFragmentArchived: false,
      officialSourceArchived: false,
      userSourceArchived: false,
    });
    expect(row.completeness).toBe('never-crawled');
    expect(row.pillars.statement).toBe('missing');
  });

  test('maps missing-official-source status to incomplete-upstream completeness', () => {
    const row = mapCoverageRecordToRow({
      ...baseRecord,
      archiveCompletenessStatus: 'missing-official-source',
      officialSourceStatus: 'restricted-upstream',
      officialSourceArchived: false,
      officialSourceBlocked: true,
    });
    expect(row.completeness).toBe('incomplete-upstream');
    expect(row.pillars.officialSource).toBe('restricted');
  });

  test('maps unsolved (partial/notAttempted) record to not-applicable mySource', () => {
    const row = mapCoverageRecordToRow({
      ...baseRecord,
      solvedByMe: false,
      userSourceArchived: false,
      userSourceLanguages: [],
      progressState: 'not-attempted',
    });
    expect(row.progress).toBe('not-attempted');
    expect(row.pillars.mySource).toBe('not-applicable');
  });
});
