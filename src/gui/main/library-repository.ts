import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  ProblemCoverageIndex,
  ProblemCoverageRecord,
} from '../../types/records.js';
import type { LibraryFilters, PillarFilter } from '../renderer/library-shell/useFilters.js';

export type RowPillar =
  | 'captured'
  | 'missing'
  | 'restricted'
  | 'not-applicable';

export type RowCompleteness =
  | 'complete'
  | 'incomplete-my-gap'
  | 'incomplete-upstream'
  | 'never-crawled';

export interface ProblemRowInput {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly grade?: number;
  readonly tags: readonly string[];
  readonly progress: 'solved' | 'partial' | 'not-attempted';
  readonly bestScore: number;
  readonly completeness: RowCompleteness;
  readonly pillars: Readonly<{
    readonly statement: RowPillar;
    readonly editorial: RowPillar;
    readonly officialSource: RowPillar;
    readonly mySource: RowPillar;
    readonly tests: RowPillar;
  }>;
  readonly languagesTried: readonly string[];
}

export interface ListProblemsInput {
  readonly rows: readonly ProblemRowInput[];
  readonly filters: LibraryFilters;
  readonly sort: {
    readonly key: 'id' | 'name' | 'grade' | 'progress' | 'bestScore';
    readonly dir: 'asc' | 'desc';
  };
  readonly limit: number;
  readonly offset: number;
}

export interface ListProblemsResult {
  readonly totalCount: number;
  readonly rows: readonly ProblemRowInput[];
}

export function listProblems(input: ListProblemsInput): ListProblemsResult {
  const filtered = input.rows.filter((row) => matchesFilters(row, input.filters));
  const sorted = [...filtered].sort(compareBy(input.sort));
  return {
    totalCount: filtered.length,
    rows: sorted.slice(input.offset, input.offset + input.limit),
  };
}

export function collectTags(rows: readonly ProblemRowInput[]): readonly string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const tag of row.tags) set.add(tag);
  }
  return [...set].sort();
}

export function mapCoverageRecordToRow(
  record: ProblemCoverageRecord,
): ProblemRowInput {
  return {
    id: String(record.problemId),
    name: record.name,
    slug: record.slug,
    grade: record.grade,
    tags: record.tags,
    progress: record.progressState ?? deriveProgress(record),
    bestScore: record.bestScore ?? 0,
    completeness: mapCompleteness(record),
    pillars: {
      statement: record.statementArchived ? 'captured' : 'missing',
      editorial: mapEditorial(record.editorialAvailability),
      officialSource: mapOfficialSource(record),
      mySource: mapMySource(record),
      tests: mapTests(record),
    },
    languagesTried: record.languagesTried ?? [],
  };
}

export function loadProblemRowsFromSnapshot(
  archiveRoot: string,
  snapshotId: string,
): readonly ProblemRowInput[] {
  const indexPath = join(
    archiveRoot,
    'snapshots',
    snapshotId,
    'normalized',
    'problem-coverage',
    'index.json',
  );
  if (!existsSync(indexPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as
      | ProblemCoverageIndex
      | undefined;
    if (!parsed?.records) return [];
    return parsed.records.map(mapCoverageRecordToRow);
  } catch {
    return [];
  }
}

function matchesFilters(row: ProblemRowInput, f: LibraryFilters): boolean {
  if (f.search) {
    const haystack = [row.id, row.name, row.slug, ...row.tags]
      .join('\n')
      .toLowerCase();
    if (!haystack.includes(f.search.toLowerCase())) return false;
  }
  if (f.grades.length > 0 && (!row.grade || !f.grades.includes(row.grade))) {
    return false;
  }
  if (f.progress !== 'all' && row.progress !== f.progress) return false;
  if (f.completeness !== 'all' && row.completeness !== f.completeness) {
    return false;
  }
  if (!pillarMatches(row.pillars.statement, f.statement)) return false;
  if (!pillarMatches(row.pillars.editorial, f.editorial)) return false;
  if (!pillarMatches(row.pillars.officialSource, f.officialSource)) return false;
  if (!pillarMatches(row.pillars.mySource, f.mySource)) return false;
  if (!pillarMatches(row.pillars.tests, f.tests)) return false;
  if (
    f.languagesTried.length > 0 &&
    !f.languagesTried.some((lang) => row.languagesTried.includes(lang))
  ) {
    return false;
  }
  if (
    row.bestScore < f.bestScoreRange[0] ||
    row.bestScore > f.bestScoreRange[1]
  ) {
    return false;
  }
  if (f.tags.length > 0 && !f.tags.every((tag) => row.tags.includes(tag))) {
    return false;
  }
  return true;
}

function pillarMatches(actual: RowPillar, want: PillarFilter): boolean {
  if (want === 'all') return true;
  return want === actual;
}

function compareBy(sort: ListProblemsInput['sort']) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return (a: ProblemRowInput, b: ProblemRowInput) => {
    const av = valueFor(a, sort.key);
    const bv = valueFor(b, sort.key);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  };
}

function valueFor(
  row: ProblemRowInput,
  key: ListProblemsInput['sort']['key'],
): string | number {
  switch (key) {
    case 'id':
      return parseInt(row.id, 10);
    case 'name':
      return row.name.toLowerCase();
    case 'grade':
      return row.grade ?? 0;
    case 'progress':
      return row.progress === 'solved'
        ? 2
        : row.progress === 'partial'
          ? 1
          : 0;
    case 'bestScore':
      return row.bestScore;
  }
}

function deriveProgress(
  record: ProblemCoverageRecord,
): ProblemRowInput['progress'] {
  if (record.solvedByMe) return 'solved';
  if ((record.bestScore ?? 0) > 0) return 'partial';
  return 'not-attempted';
}

function mapCompleteness(record: ProblemCoverageRecord): RowCompleteness {
  switch (record.archiveCompletenessStatus) {
    case 'complete':
      return 'complete';
    case 'not-archived-yet':
      return 'never-crawled';
    case 'missing-official-source':
    case 'unsolved':
      return 'incomplete-upstream';
    case 'missing-user-source':
    case 'incomplete':
      return 'incomplete-my-gap';
  }
}

function mapEditorial(
  availability: ProblemCoverageRecord['editorialAvailability'],
): RowPillar {
  switch (availability) {
    case 'visible':
      return 'captured';
    case 'restricted':
      return 'restricted';
    case 'hidden':
    case 'unknown':
      return 'missing';
  }
}

function mapOfficialSource(record: ProblemCoverageRecord): RowPillar {
  if (record.officialSourceArchived) return 'captured';
  if (record.officialSourceStatus === 'not-available-upstream') {
    return 'not-applicable';
  }
  if (
    record.officialSourceBlocked ||
    record.officialSourceStatus === 'restricted-upstream'
  ) {
    return 'restricted';
  }
  return 'missing';
}

function mapMySource(record: ProblemCoverageRecord): RowPillar {
  if (record.userSourceArchived) return 'captured';
  // "Not applicable" when the operator hasn't solved the problem at 100pt, so no
  // user source is ever expected. Otherwise it's a gap ("missing").
  if (!record.solvedByMe) return 'not-applicable';
  if (record.missingTrustworthyUserSourceLanguages.length > 0) return 'missing';
  return 'not-applicable';
}

function mapTests(record: ProblemCoverageRecord): RowPillar {
  switch (record.testsCoverageStatus) {
    case 'captured':
      return 'captured';
    case 'not-available-upstream':
      return 'not-applicable';
    case 'not-captured-yet':
      return 'missing';
  }
}
