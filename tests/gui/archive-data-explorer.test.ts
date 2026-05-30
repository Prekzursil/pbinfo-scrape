import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  getArchiveExplorerSummary,
  listArchiveExplorerRecords,
  readArchiveExplorerRecord,
} from '../../src/gui/main/archive-data-explorer.js';
import type {
  EvaluationRecord,
  MirrorRouteRecord,
  ProblemRecord,
  ProblemTestsRecord,
} from '../../src/types/records.js';

const SNAPSHOT_ID = '20240101T000000Z';
const tempDirs: string[] = [];

interface SeededWorkspace {
  workspaceRoot: string;
  normalizedRoot: string;
  mirrorRoot: string;
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function makeProblem(overrides: Partial<ProblemRecord> = {}): ProblemRecord {
  return {
    id: 101,
    slug: 'suma',
    name: 'Suma a doua numere',
    canonicalUrl: 'https://www.pbinfo.ro/probleme/101/suma',
    categoryChain: [],
    tags: [],
    sections: [],
    examples: [],
    constraints: ['1 <= n <= 100', '0 <= a <= 1000', 'extra constraint'],
    editorialAvailability: 'unknown',
    officialSolutions: {},
    visibleTests: [],
    linkedAssets: [],
    metadata: {},
    ...overrides,
  };
}

function makeEvaluation(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    evaluationId: 5001,
    problemId: 101,
    problemSlug: 'suma',
    problemName: 'Suma a doua numere',
    language: 'cpp',
    user: 'studentul',
    score: 100,
    verdictSummary: 'Accepted',
    sourceAvailable: true,
    suspicionFlags: [],
    tests: [],
    fetchedAt: '2024-01-01T00:00:00.000Z',
    provenance: [],
    ...overrides,
  };
}

function makeTests(overrides: Partial<ProblemTestsRecord> = {}): ProblemTestsRecord {
  return {
    snapshotId: SNAPSHOT_ID,
    problemId: 101,
    problemSlug: 'suma',
    problemName: 'Suma a doua numere',
    examples: [],
    visible: [],
    evaluationObserved: [],
    effective: [],
    ...overrides,
  };
}

function makeRoute(overrides: Partial<MirrorRouteRecord> = {}): MirrorRouteRecord {
  return {
    snapshotId: SNAPSHOT_ID,
    route: '/probleme/101/suma',
    sourceUrl: 'https://www.pbinfo.ro/probleme/101/suma',
    template: 'problem',
    entityKey: 'problem:101',
    ...overrides,
  };
}

function seedWorkspace(): SeededWorkspace {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-explorer-'));
  tempDirs.push(workspaceRoot);
  const snapshotRoot = join(workspaceRoot, 'archive', 'snapshots', SNAPSHOT_ID);
  const normalizedRoot = join(snapshotRoot, 'normalized');
  const mirrorRoot = join(snapshotRoot, 'mirror');

  writeJson(join(normalizedRoot, 'problems', 'problem-101.json'), makeProblem());
  writeJson(
    join(normalizedRoot, 'problems', 'problem-202.json'),
    makeProblem({
      id: 202,
      slug: 'produs',
      name: 'Produs',
      canonicalUrl: undefined,
      constraints: [],
    }),
  );
  writeJson(join(normalizedRoot, 'evaluations', 'evaluation-5001.json'), makeEvaluation());
  writeJson(
    join(normalizedRoot, 'evaluations', 'evaluation-5002.json'),
    makeEvaluation({ evaluationId: 5002, user: 'altul', score: 50 }),
  );
  writeJson(join(normalizedRoot, 'tests', 'problem-101.json'), makeTests());
  writeJson(join(normalizedRoot, 'rankings', 'best-submissions.json'), {
    generatedAt: '2024-01-01T00:00:00.000Z',
    problems: [
      {
        problemId: 101,
        bestUserOverallEvaluationId: 5001,
        bestUserPerLanguage: { cpp: 5001 },
        bestOfficialPerLanguage: {},
        orderedUserEvaluationIds: [5001, 5002],
      },
      {
        // Missing problemId is filtered out.
        bestUserPerLanguage: {},
      },
      {
        problemId: 303,
        bestUserPerLanguage: {},
      },
    ],
  });
  writeJson(join(normalizedRoot, 'rankings', 'problems', 'problem-101.json'), {
    problemId: 101,
    bestUserPerLanguage: { cpp: 5001 },
  });

  return { workspaceRoot, normalizedRoot, mirrorRoot };
}

beforeEach(() => {
  tempDirs.length = 0;
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('getArchiveExplorerSummary', () => {
  test('summarizes all datasets using directory and manifest counts', () => {
    const { workspaceRoot, mirrorRoot } = seedWorkspace();
    writeJson(join(mirrorRoot, 'routes.json'), [
      makeRoute(),
      makeRoute({ route: '/probleme/202/produs' }),
    ]);

    const summary = getArchiveExplorerSummary(workspaceRoot, { snapshotId: SNAPSHOT_ID });

    expect(summary.snapshotId).toBe(SNAPSHOT_ID);
    expect(summary.mirrorServeCommand).toContain(SNAPSHOT_ID);
    const counts = Object.fromEntries(summary.datasets.map((d) => [d.dataset, d.count]));
    expect(counts.problems).toBe(2);
    expect(counts.evaluations).toBe(2);
    expect(counts.tests).toBe(1);
    expect(counts.rankings).toBe(3);
    expect(counts['mirror-routes']).toBe(2);
  });

  test('falls back to route directory count when no manifest exists', () => {
    const { workspaceRoot, normalizedRoot } = seedWorkspace();
    writeJson(join(normalizedRoot, 'routes', 'route-a.json'), makeRoute());
    writeJson(join(normalizedRoot, 'routes', 'route-b.json'), makeRoute({ route: '/x' }));

    const summary = getArchiveExplorerSummary(workspaceRoot, { snapshotId: SNAPSHOT_ID });
    const routesSummary = summary.datasets.find((d) => d.dataset === 'mirror-routes');

    expect(routesSummary?.count).toBe(2);
  });

  test('reports zero counts for an empty snapshot', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-empty-'));
    tempDirs.push(workspaceRoot);

    const summary = getArchiveExplorerSummary(workspaceRoot, { snapshotId: SNAPSHOT_ID });

    for (const dataset of summary.datasets) {
      expect(dataset.count).toBe(0);
    }
  });

  test('resolves the current snapshot from the catalog when none is supplied', () => {
    const { workspaceRoot } = seedWorkspace();
    writeJson(join(workspaceRoot, 'archive', 'catalog.json'), {
      currentSnapshotId: SNAPSHOT_ID,
      snapshots: [],
      artifactExports: [],
    });

    const summary = getArchiveExplorerSummary(workspaceRoot);

    expect(summary.snapshotId).toBe(SNAPSHOT_ID);
  });

  test('throws when no snapshot is available', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-none-'));
    tempDirs.push(workspaceRoot);

    expect(() => getArchiveExplorerSummary(workspaceRoot)).toThrow(
      'No archived snapshot is available.',
    );
  });
});

describe('listArchiveExplorerRecords', () => {
  test('lists problems sorted ascending with derived routes and subtitles', () => {
    const { workspaceRoot } = seedWorkspace();

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'problems',
    });

    expect(listing.totalCount).toBe(2);
    expect(listing.items.map((item) => item.recordId)).toEqual(['101', '202']);
    expect(listing.items[0]!.subtitle).toBe('/probleme/101/suma');
    expect(listing.items[0]!.description).toBe('1 <= n <= 100 • 0 <= a <= 1000');
    // Problem 202 has no canonicalUrl, so route is derived from id/slug.
    expect(listing.items[1]!.mirrorRoute).toBe('/probleme/202/produs');
    expect(listing.items[1]!.subtitle).toBeUndefined();
    expect(listing.items[1]!.description).toBeUndefined();
  });

  test('lists evaluations sorted descending', () => {
    const { workspaceRoot } = seedWorkspace();

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'evaluations',
    });

    expect(listing.items.map((item) => item.recordId)).toEqual(['5002', '5001']);
    expect(listing.items[1]!.mirrorRoute).toBe('/detalii-evaluare/5001');
  });

  test('lists tests records', () => {
    const { workspaceRoot } = seedWorkspace();

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'tests',
    });

    expect(listing.items).toHaveLength(1);
    expect(listing.items[0]!.mirrorRoute).toBe('/probleme/101/suma');
    expect(listing.items[0]!.subtitle).toContain('examples: 0');
  });

  test('lists rankings with problem names and language winners', () => {
    const { workspaceRoot } = seedWorkspace();

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'rankings',
    });

    expect(listing.items.map((item) => item.recordId)).toEqual(['101', '303']);
    const first = listing.items[0]!;
    expect(first.title).toBe('#101 Suma a doua numere');
    expect(first.subtitle).toContain('Best user languages: cpp');
    expect(first.description).toContain('5001');
    // Problem 303 has no problem record and no winners/overall best.
    const second = listing.items[1]!;
    expect(second.title).toBe('Problem #303');
    expect(second.subtitle).toBe('No language winners recorded');
    expect(second.description).toBe('No overall best user evaluation recorded');
    expect(second.mirrorRoute).toBeUndefined();
  });

  test('lists mirror routes from the manifest and applies query filtering', () => {
    const { workspaceRoot, mirrorRoot } = seedWorkspace();
    writeJson(join(mirrorRoot, 'routes.json'), [
      makeRoute(),
      makeRoute({
        route: '/detalii-evaluare/5001',
        template: 'evaluation',
        sourceUrl: undefined,
        entityKey: 'eval:5001',
      }),
    ]);

    const all = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'mirror-routes',
    });
    expect(all.items.map((item) => item.recordId)).toEqual([
      '/detalii-evaluare/5001',
      '/probleme/101/suma',
    ]);
    expect(all.items[0]!.description).toBe('eval:5001');

    const filtered = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'mirror-routes',
      query: 'detalii',
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]!.recordId).toBe('/detalii-evaluare/5001');
  });

  test('falls back to the route directory when the manifest is empty', () => {
    const { workspaceRoot, normalizedRoot, mirrorRoot } = seedWorkspace();
    writeJson(join(mirrorRoot, 'routes.json'), []);
    writeJson(join(normalizedRoot, 'routes', 'route-1.json'), makeRoute({ route: '/from-dir' }));

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'mirror-routes',
    });

    expect(listing.items).toHaveLength(1);
    expect(listing.items[0]!.recordId).toBe('/from-dir');
  });

  test('applies query, offset, and limit', () => {
    const { workspaceRoot } = seedWorkspace();

    const limited = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'problems',
      offset: 1,
      limit: 1,
    });
    expect(limited.items.map((item) => item.recordId)).toEqual(['202']);
    expect(limited.totalCount).toBe(2);

    const queried = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'problems',
      query: '   PRODUS  ',
    });
    expect(queried.items.map((item) => item.recordId)).toEqual(['202']);
  });

  test('skips unreadable JSON files in a dataset directory', () => {
    const { workspaceRoot, normalizedRoot } = seedWorkspace();
    writeFileSync(join(normalizedRoot, 'problems', 'problem-broken.json'), '{ not json', 'utf8');

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'problems',
    });

    expect(listing.totalCount).toBe(2);
  });
});

describe('readArchiveExplorerRecord', () => {
  test('reads a problem record detail', () => {
    const { workspaceRoot } = seedWorkspace();

    const detail = readArchiveExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'problems',
      recordId: '101',
    });

    expect(detail.dataset).toBe('problems');
    expect(detail.mirrorRoute).toBe('/probleme/101/suma');
    expect((detail.payload as ProblemRecord).id).toBe(101);
  });

  test('reads an evaluation record detail', () => {
    const { workspaceRoot } = seedWorkspace();

    const detail = readArchiveExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'evaluations',
      recordId: '5001',
    });

    expect(detail.mirrorRoute).toBe('/detalii-evaluare/5001');
    expect(detail.subtitle).toContain('Accepted');
  });

  test('reads a tests record detail', () => {
    const { workspaceRoot } = seedWorkspace();

    const detail = readArchiveExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'tests',
      recordId: '101',
    });

    expect(detail.mirrorRoute).toBe('/probleme/101/suma');
  });

  test('reads a ranking record detail and falls back to the index entry', () => {
    const { workspaceRoot } = seedWorkspace();

    const withProblemFile = readArchiveExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'rankings',
      recordId: '101',
    });
    expect(withProblemFile.title).toBe('#101 Suma a doua numere');
    expect(withProblemFile.subtitle).toContain('5001');

    // Problem 303 has no ranking file and no problem record, exercising fallbacks.
    const fallback = readArchiveExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'rankings',
      recordId: '303',
    });
    expect(fallback.title).toBe('Problem #303');
    expect(fallback.subtitle).toBe('No overall best user evaluation recorded');
    expect(fallback.mirrorRoute).toBeUndefined();
  });

  test('throws for an unknown ranking record', () => {
    const { workspaceRoot } = seedWorkspace();

    expect(() =>
      readArchiveExplorerRecord(workspaceRoot, {
        snapshotId: SNAPSHOT_ID,
        dataset: 'rankings',
        recordId: '99999',
      }),
    ).toThrow('Ranking record "99999" was not found.');
  });

  test('reads a mirror route detail from the manifest', () => {
    const { workspaceRoot, mirrorRoot } = seedWorkspace();
    writeJson(join(mirrorRoot, 'routes.json'), [makeRoute()]);

    const detail = readArchiveExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'mirror-routes',
      recordId: '/probleme/101/suma',
    });

    expect(detail.title).toBe('/probleme/101/suma');
    expect(detail.subtitle).toBe('problem');
  });

  test('reads a mirror route detail from the route directory fallback', () => {
    const { workspaceRoot, normalizedRoot } = seedWorkspace();
    writeJson(join(normalizedRoot, 'routes', 'route-1.json'), makeRoute({ route: '/from-dir' }));

    const detail = readArchiveExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'mirror-routes',
      recordId: '/from-dir',
    });

    expect(detail.title).toBe('/from-dir');
    expect(detail.filePath).toContain('route-from-dir.json');
  });

  test('throws for an unknown mirror route', () => {
    const { workspaceRoot } = seedWorkspace();

    expect(() =>
      readArchiveExplorerRecord(workspaceRoot, {
        snapshotId: SNAPSHOT_ID,
        dataset: 'mirror-routes',
        recordId: '/missing',
      }),
    ).toThrow('Mirror route "/missing" was not found.');
  });

  test('throws when a required record file is missing', () => {
    const { workspaceRoot } = seedWorkspace();

    expect(() =>
      readArchiveExplorerRecord(workspaceRoot, {
        snapshotId: SNAPSHOT_ID,
        dataset: 'problems',
        recordId: '99999',
      }),
    ).toThrow('is missing or unreadable');
  });
});

describe('archive-data-explorer edge branches', () => {
  test('compareNumericIds falls back to localeCompare for non-numeric route IDs', () => {
    // Mirror route IDs are strings like "/probleme/101/suma" — not numeric.
    // listMirrorRouteItems sorts via recordId.localeCompare, but listProblemItems etc.
    // use compareNumericIds.  Inject two problems whose IDs are non-numeric strings
    // by using slug-style recordIds so the localeCompare branch (line 519) is hit.
    //
    // The easiest path: write two ranking entries with non-numeric problemIds (we
    // can't really do that, since problemId is typed as number). Instead, seed two
    // tests records whose problemId stringified produces non-numeric values by
    // giving them IDs that aren't finite numbers — we can abuse the ProblemRecord
    // path by providing a problem with id=0 (falsy).
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-nonnum-'));
    tempDirs.push(workspaceRoot);
    const snapshotRoot = join(workspaceRoot, 'archive', 'snapshots', SNAPSHOT_ID);
    const normalizedRoot = join(snapshotRoot, 'normalized');

    // Write a ranking index with a non-numeric problemId to exercise compareNumericIds
    // via the ranking sort path.  Filter type-guard requires typeof === 'number', so
    // give it entries with proper number IDs but ones whose string form isn't finite
    // when parsed — that's not possible with real ints. Instead write TWO problems
    // both with numeric IDs but the RANKING sort uses compareNumericIds on their
    // string recordIds: still numeric. So use mirror route sort, which uses
    // localeCompare directly.
    //
    // For compareNumericIds non-numeric branch we use listProblemItems with a problem
    // that has id=0 (Number("0") is finite so still numeric) — that won't work.
    // The real way: write problem files with non-numeric filenames whose payload.id
    // won't be a number. Actually the simplest: pass NaN-producing IDs.
    // problem.id = undefined → String(undefined) = "undefined" → Number("undefined") = NaN.
    writeJson(
      join(normalizedRoot, 'problems', 'problem-a.json'),
      { id: undefined, name: 'Alpha', canonicalUrl: undefined, slug: 'alpha', constraints: [], tags: [], sections: [], examples: [], categoryChain: [], editorialAvailability: 'unknown', officialSolutions: {}, visibleTests: [], linkedAssets: [], metadata: {} },
    );
    writeJson(
      join(normalizedRoot, 'problems', 'problem-b.json'),
      { id: undefined, name: 'Beta', canonicalUrl: undefined, slug: 'beta', constraints: [], tags: [], sections: [], examples: [], categoryChain: [], editorialAvailability: 'unknown', officialSolutions: {}, visibleTests: [], linkedAssets: [], metadata: {} },
    );

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'problems',
    });
    // Both items have recordId "undefined" (NaN path → localeCompare), just verify they render.
    expect(listing.totalCount).toBe(2);
  });

  test('deriveProblemRoute returns undefined when problem has no canonicalUrl and no id', () => {
    // Exercises lines 529-530: problem.id is falsy → return undefined
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-noid-'));
    tempDirs.push(workspaceRoot);
    const snapshotRoot = join(workspaceRoot, 'archive', 'snapshots', SNAPSHOT_ID);
    const normalizedRoot = join(snapshotRoot, 'normalized');

    // Problem with no id and no canonicalUrl → deriveProblemRoute returns undefined
    writeJson(join(normalizedRoot, 'problems', 'problem-999.json'), {
      id: 0,
      name: 'Zero Id Problem',
      canonicalUrl: undefined,
      slug: 'zero-id',
      constraints: [],
      tags: [],
      sections: [],
      examples: [],
      categoryChain: [],
      editorialAvailability: 'unknown',
      officialSolutions: {},
      visibleTests: [],
      linkedAssets: [],
      metadata: {},
    });

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'problems',
    });
    // Problem id=0 is falsy → mirrorRoute is undefined
    expect(listing.items[0]!.mirrorRoute).toBeUndefined();
  });

  test('extractPathname returns undefined for an invalid URL', () => {
    // Exercises lines 536-537: new URL(url) throws → catch returns undefined
    // A problem with a malformed canonicalUrl triggers extractPathname's catch block.
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-badurl-'));
    tempDirs.push(workspaceRoot);
    const snapshotRoot = join(workspaceRoot, 'archive', 'snapshots', SNAPSHOT_ID);
    const normalizedRoot = join(snapshotRoot, 'normalized');

    writeJson(join(normalizedRoot, 'problems', 'problem-1.json'), {
      id: 1,
      name: 'Bad URL Problem',
      canonicalUrl: 'http://[invalid-url',
      slug: 'bad-url',
      constraints: [],
      tags: [],
      sections: [],
      examples: [],
      categoryChain: [],
      editorialAvailability: 'unknown',
      officialSolutions: {},
      visibleTests: [],
      linkedAssets: [],
      metadata: {},
    });

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'problems',
    });
    // subtitle uses extractPathname(canonicalUrl) → URL parse throws → undefined
    expect(listing.items[0]!.subtitle).toBeUndefined();
  });

  test('readArchiveExplorerRecord for problem with no canonicalUrl yields undefined subtitle', () => {
    // Exercises line 334: payload.canonicalUrl falsy → subtitle is undefined in readProblemRecordDetail
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-nocanon-'));
    tempDirs.push(workspaceRoot);
    const snapshotRoot = join(workspaceRoot, 'archive', 'snapshots', SNAPSHOT_ID);
    const normalizedRoot = join(snapshotRoot, 'normalized');

    writeJson(join(normalizedRoot, 'problems', 'problem-55.json'), {
      id: 55,
      name: 'No Canonical',
      canonicalUrl: undefined,
      slug: 'no-canonical',
      constraints: [],
      tags: [],
      sections: [],
      examples: [],
      categoryChain: [],
      editorialAvailability: 'unknown',
      officialSolutions: {},
      visibleTests: [],
      linkedAssets: [],
      metadata: {},
    });

    const detail = readArchiveExplorerRecord(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'problems',
      recordId: '55',
    });
    expect(detail.subtitle).toBeUndefined();
  });

  test('countRankingEntries returns 0 when ranking index has no problems field', () => {
    // Exercises line 442: readRankingIndex(...).problems?.length ?? 0 → undefined ?? 0
    // And line 380: index.problems ?? [] → [] when problems is missing
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-noproblems-'));
    tempDirs.push(workspaceRoot);
    const snapshotRoot = join(workspaceRoot, 'archive', 'snapshots', SNAPSHOT_ID);
    const normalizedRoot = join(snapshotRoot, 'normalized');

    // Write ranking index without a "problems" field
    writeJson(join(normalizedRoot, 'rankings', 'best-submissions.json'), {
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    const summary = getArchiveExplorerSummary(workspaceRoot, { snapshotId: SNAPSHOT_ID });
    const rankingsSummary = summary.datasets.find((d) => d.dataset === 'rankings');
    // problems?.length ?? 0 → 0 because problems is undefined
    expect(rankingsSummary?.count).toBe(0);

    // Also test listArchiveExplorerRecords when problems is missing → empty list
    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'rankings',
    });
    expect(listing.totalCount).toBe(0);
  });

  test('listRankingItems uses empty object when bestUserPerLanguage is missing', () => {
    // Exercises line 274: entry.bestUserPerLanguage ?? {} when field is absent
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-nolang-'));
    tempDirs.push(workspaceRoot);
    const snapshotRoot = join(workspaceRoot, 'archive', 'snapshots', SNAPSHOT_ID);
    const normalizedRoot = join(snapshotRoot, 'normalized');

    writeJson(join(normalizedRoot, 'rankings', 'best-submissions.json'), {
      generatedAt: '2026-01-01T00:00:00.000Z',
      problems: [
        { problemId: 77 }, // no bestUserPerLanguage field at all
      ],
    });

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'rankings',
    });
    expect(listing.items[0]!.subtitle).toBe('No language winners recorded');
  });

  test('readRankingRecordDetail when index has no problems field throws not-found', () => {
    // Exercises line 380: index.problems ?? [] → [] → indexEntry is undefined → throws
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-ranknoitems-'));
    tempDirs.push(workspaceRoot);
    const snapshotRoot = join(workspaceRoot, 'archive', 'snapshots', SNAPSHOT_ID);
    const normalizedRoot = join(snapshotRoot, 'normalized');

    writeJson(join(normalizedRoot, 'rankings', 'best-submissions.json'), {
      generatedAt: '2026-01-01T00:00:00.000Z',
      // no "problems" key
    });

    expect(() =>
      readArchiveExplorerRecord(workspaceRoot, {
        snapshotId: SNAPSHOT_ID,
        dataset: 'rankings',
        recordId: '42',
      }),
    ).toThrow('Ranking record "42" was not found.');
  });
});
