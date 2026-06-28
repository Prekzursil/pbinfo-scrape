import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  getArchiveExplorerSummary,
  listArchiveExplorerRecords,
  readArchiveExplorerRecord,
} from '../../src/gui/main/archive-data-explorer.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-explorer-'));
  tempDirs.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

function normalizedRoot(root: string, snapshotId: string): string {
  return join(root, 'archive', 'snapshots', snapshotId, 'normalized');
}

function writeCatalog(root: string, snapshotId: string | undefined): void {
  writeJson(join(root, 'archive', 'catalog.json'), {
    currentSnapshotId: snapshotId,
    canonicalSnapshotId: snapshotId,
    snapshots: snapshotId
      ? [
          {
            snapshotId,
            createdAt: '2026-01-01T00:00:00.000Z',
            scope: 'all',
            status: 'completed',
            checkpoint: 'canonical',
          },
        ]
      : [],
    artifactExports: [],
  });
}

function problemRecord(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 1,
    slug: 'alpha',
    name: 'Alpha',
    canonicalUrl: 'https://www.pbinfo.ro/probleme/1/alpha',
    categoryChain: [],
    tags: [],
    sections: [],
    examples: [],
    constraints: ['1 <= n <= 10', 'n is even'],
    editorialAvailability: 'visible',
    officialSolutions: {},
    visibleTests: [],
    linkedAssets: [],
    metadata: {},
    ...overrides,
  };
}

function buildFullWorkspace(): { root: string; snapshotId: string } {
  const root = makeWorkspace();
  const snapshotId = 'SNAP1';
  writeCatalog(root, snapshotId);
  const norm = normalizedRoot(root, snapshotId);

  // Problems: one with canonicalUrl + constraints, one without canonicalUrl and
  // empty constraints (covers undefined subtitle/description + id-route branch),
  // plus a non-JSON entry and an unparseable file (covers directory filters).
  writeJson(join(norm, 'problems', 'problem-1.json'), problemRecord());
  writeJson(
    join(norm, 'problems', 'problem-2.json'),
    problemRecord({ id: 2, slug: 'beta', name: 'Beta', canonicalUrl: undefined, constraints: [] }),
  );
  // Non-numeric id problem (forces compareNumericIds localeCompare fallback).
  writeJson(
    join(norm, 'problems', 'problem-x.json'),
    problemRecord({ id: 'abc', slug: 'x', name: 'X', canonicalUrl: undefined }),
  );
  writeFileSync(join(norm, 'problems', 'notes.txt'), 'ignore me', 'utf8');
  writeFileSync(join(norm, 'problems', 'broken.json'), '{ not json', 'utf8');

  // Evaluations.
  writeJson(join(norm, 'evaluations', 'evaluation-100.json'), {
    evaluationId: 100,
    problemId: 1,
    problemSlug: 'alpha',
    problemName: 'Alpha',
    language: 'cpp',
    user: 'alice',
    score: 100,
    verdictSummary: 'Accepted',
    sourceAvailable: true,
    suspicionFlags: [],
    tests: [],
    fetchedAt: '2026-01-01T00:00:00.000Z',
    provenance: [],
  });
  writeJson(join(norm, 'evaluations', 'evaluation-200.json'), {
    evaluationId: 200,
    problemId: 2,
    problemSlug: 'beta',
    problemName: 'Beta',
    language: 'py',
    user: 'bob',
    score: 50,
    verdictSummary: 'Partial',
    sourceAvailable: false,
    suspicionFlags: [],
    tests: [],
    fetchedAt: '2026-01-01T00:00:00.000Z',
    provenance: [],
  });

  // Tests.
  writeJson(join(norm, 'tests', 'problem-1.json'), {
    snapshotId,
    problemId: 1,
    problemSlug: 'alpha',
    problemName: 'Alpha',
    examples: [{ testId: 'e1', kind: 'example' }],
    visible: [],
    evaluationObserved: [],
    effective: [],
  });

  // Rankings index: id1 has languages + overall + a per-problem file; id2 has no
  // languages and no overall + no per-problem file; one entry has no problemId.
  writeJson(join(norm, 'rankings', 'best-submissions.json'), {
    generatedAt: '2026-01-01T00:00:00.000Z',
    problems: [
      { problemId: 1, bestUserOverallEvaluationId: 100, bestUserPerLanguage: { cpp: 100 } },
      { problemId: 2, bestUserPerLanguage: {} },
      { bestUserPerLanguage: {} },
    ],
  });
  writeJson(join(norm, 'rankings', 'problems', 'problem-1.json'), { problemId: 1, best: 100 });

  // Mirror routes manifest (present + non-empty path).
  writeJson(join(root, 'archive', 'snapshots', snapshotId, 'mirror', 'routes.json'), [
    {
      snapshotId,
      route: '/probleme/1/alpha',
      sourceUrl: 'https://www.pbinfo.ro/probleme/1/alpha',
      template: 'problem',
      entityKey: '1',
    },
    {
      snapshotId,
      route: '/raw/page',
      template: 'raw-page',
      entityKey: 'raw-key',
    },
  ]);
  // Routes directory record only reachable via the directory fallback.
  writeJson(join(norm, 'routes', 'route-dir-only.json'), {
    snapshotId,
    route: '/dir/only',
    template: 'raw-page',
    entityKey: 'dir-key',
  });

  return { root, snapshotId };
}

describe('archive-data-explorer summary', () => {
  test('reports dataset counts from manifest and index sources', () => {
    const { root } = buildFullWorkspace();
    const summary = getArchiveExplorerSummary(root);

    expect(summary.snapshotId).toBe('SNAP1');
    const byDataset = Object.fromEntries(summary.datasets.map((d) => [d.dataset, d.count]));
    // countJsonFiles counts by extension (includes the unparseable file);
    // listings skip the unparseable one (3 readable records).
    expect(byDataset.problems).toBe(4);
    expect(byDataset.evaluations).toBe(2);
    expect(byDataset.tests).toBe(1);
    expect(byDataset.rankings).toBe(3);
    expect(byDataset['mirror-routes']).toBe(2);
    expect(summary.mirrorServeCommand).toContain('SNAP1');
  });

  test('falls back to the routes directory count when no manifest exists', () => {
    const root = makeWorkspace();
    const snapshotId = 'NOMAN';
    writeCatalog(root, snapshotId);
    const norm = normalizedRoot(root, snapshotId);
    writeJson(join(norm, 'routes', 'route-a.json'), {
      snapshotId,
      route: '/a',
      template: 'raw-page',
      entityKey: 'a',
    });

    const summary = getArchiveExplorerSummary(root, { snapshotId });
    const routes = summary.datasets.find((d) => d.dataset === 'mirror-routes');
    expect(routes?.count).toBe(1);
  });

  test('returns zero counts for an empty snapshot', () => {
    const root = makeWorkspace();
    writeCatalog(root, 'EMPTY');
    const summary = getArchiveExplorerSummary(root);
    for (const dataset of summary.datasets) {
      expect(dataset.count).toBe(0);
    }
  });

  test('throws when no snapshot is available', () => {
    const root = makeWorkspace();
    writeCatalog(root, undefined);
    expect(() => getArchiveExplorerSummary(root)).toThrow(/No archived snapshot/);
  });
});

describe('archive-data-explorer listings', () => {
  test('lists problems with derived routes and applies query + pagination', () => {
    const { root } = buildFullWorkspace();
    const all = listArchiveExplorerRecords(root, { dataset: 'problems' });
    expect(all.totalCount).toBe(3);
    expect(all.items.map((i) => i.recordId)).toContain('1');

    const withCanonical = all.items.find((i) => i.recordId === '1');
    expect(withCanonical?.subtitle).toBe('/probleme/1/alpha');
    expect(withCanonical?.description).toBe('1 <= n <= 10 • n is even');

    const noCanonical = all.items.find((i) => i.recordId === '2');
    expect(noCanonical?.subtitle).toBeUndefined();
    expect(noCanonical?.description).toBeUndefined();
    expect(noCanonical?.mirrorRoute).toBe('/probleme/2/beta');

    const filtered = listArchiveExplorerRecords(root, { dataset: 'problems', query: 'beta' });
    expect(filtered.totalCount).toBe(1);
    expect(filtered.items[0]?.recordId).toBe('2');

    const paged = listArchiveExplorerRecords(root, { dataset: 'problems', offset: 1, limit: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.offset).toBe(1);
  });

  test('lists evaluations, tests, rankings and mirror routes', () => {
    const { root } = buildFullWorkspace();

    const evaluations = listArchiveExplorerRecords(root, { dataset: 'evaluations' });
    expect(evaluations.items.map((i) => i.recordId)).toEqual(['200', '100']);
    expect(evaluations.items[1]?.subtitle).toContain('cpp');

    const tests = listArchiveExplorerRecords(root, { dataset: 'tests' });
    expect(tests.items[0]?.subtitle).toContain('examples: 1');

    const rankings = listArchiveExplorerRecords(root, { dataset: 'rankings' });
    expect(rankings.totalCount).toBe(2);
    const first = rankings.items.find((i) => i.recordId === '1');
    expect(first?.title).toBe('#1 Alpha');
    expect(first?.subtitle).toContain('Best user languages: cpp');
    expect(first?.description).toContain('Best user overall evaluation: 100');
    const second = rankings.items.find((i) => i.recordId === '2');
    expect(second?.subtitle).toBe('No language winners recorded');
    expect(second?.description).toBe('No overall best user evaluation recorded');

    const routes = listArchiveExplorerRecords(root, { dataset: 'mirror-routes' });
    expect(routes.items.map((i) => i.recordId)).toEqual(['/probleme/1/alpha', '/raw/page']);
    expect(routes.items[0]?.description).toBe('https://www.pbinfo.ro/probleme/1/alpha');
    expect(routes.items[1]?.description).toBe('raw-key');
  });

  test('lists mirror routes from the directory fallback when manifest is empty', () => {
    const root = makeWorkspace();
    const snapshotId = 'DIRROUTES';
    writeCatalog(root, snapshotId);
    const norm = normalizedRoot(root, snapshotId);
    writeJson(join(root, 'archive', 'snapshots', snapshotId, 'mirror', 'routes.json'), []);
    writeJson(join(norm, 'routes', 'route-z.json'), {
      snapshotId,
      route: '/z',
      template: 'raw-page',
      entityKey: 'z',
    });

    const routes = listArchiveExplorerRecords(root, { dataset: 'mirror-routes', snapshotId });
    expect(routes.items.map((i) => i.recordId)).toEqual(['/z']);
  });

  test('ranking listing handles a missing problem record', () => {
    const root = makeWorkspace();
    const snapshotId = 'RANKONLY';
    writeCatalog(root, snapshotId);
    const norm = normalizedRoot(root, snapshotId);
    writeJson(join(norm, 'rankings', 'best-submissions.json'), {
      problems: [{ problemId: 9, bestUserPerLanguage: {} }],
    });

    const rankings = listArchiveExplorerRecords(root, { dataset: 'rankings', snapshotId });
    expect(rankings.items[0]?.title).toBe('Problem #9');
    expect(rankings.items[0]?.mirrorRoute).toBeUndefined();
  });
});

describe('archive-data-explorer record detail', () => {
  test('reads problem, evaluation and tests record details', () => {
    const { root } = buildFullWorkspace();

    const problem = readArchiveExplorerRecord(root, { dataset: 'problems', recordId: '1' });
    expect(problem.title).toBe('#1 Alpha');
    expect(problem.subtitle).toBe('/probleme/1/alpha');

    const evaluation = readArchiveExplorerRecord(root, { dataset: 'evaluations', recordId: '100' });
    expect(evaluation.mirrorRoute).toBe('/detalii-evaluare/100');

    const tests = readArchiveExplorerRecord(root, { dataset: 'tests', recordId: '1' });
    expect(tests.mirrorRoute).toBe('/probleme/1/alpha');
  });

  test('reads ranking detail from per-problem file and from index fallback', () => {
    const { root } = buildFullWorkspace();

    const withFile = readArchiveExplorerRecord(root, { dataset: 'rankings', recordId: '1' });
    expect(withFile.title).toBe('#1 Alpha');
    expect(withFile.payload).toMatchObject({ problemId: 1 });

    const fromIndex = readArchiveExplorerRecord(root, { dataset: 'rankings', recordId: '2' });
    expect(fromIndex.subtitle).toBe('No overall best user evaluation recorded');
    expect(fromIndex.title).toBe('#2 Beta');
  });

  test('reads mirror route detail from manifest and from directory fallback', () => {
    const { root } = buildFullWorkspace();

    const fromManifest = readArchiveExplorerRecord(root, {
      dataset: 'mirror-routes',
      recordId: '/probleme/1/alpha',
    });
    expect(fromManifest.subtitle).toBe('problem');

    const fromDir = readArchiveExplorerRecord(root, {
      dataset: 'mirror-routes',
      recordId: '/dir/only',
    });
    expect(fromDir.title).toBe('/dir/only');
    expect(fromDir.filePath).toContain('route-dir-only.json');
  });

  test('throws for missing problem, ranking and mirror-route records', () => {
    const { root } = buildFullWorkspace();
    expect(() => readArchiveExplorerRecord(root, { dataset: 'problems', recordId: '999' })).toThrow(
      /missing or unreadable/,
    );
    expect(() => readArchiveExplorerRecord(root, { dataset: 'rankings', recordId: '999' })).toThrow(
      /was not found/,
    );
    expect(() =>
      readArchiveExplorerRecord(root, { dataset: 'mirror-routes', recordId: '/nope' }),
    ).toThrow(/was not found/);
  });

  test('handles edge cases: missing dirs, falsy ids, invalid urls, sparse rankings', () => {
    const root = makeWorkspace();
    const snapshotId = 'EDGE';
    writeCatalog(root, snapshotId);
    const norm = normalizedRoot(root, snapshotId);
    // id 0 (falsy) and no canonical url -> derived route is undefined.
    writeJson(join(norm, 'problems', 'problem-0.json'), problemRecord({
      id: 0,
      slug: 'zero',
      name: 'Zero',
      canonicalUrl: undefined,
    }));
    // invalid canonical url -> extractPathname swallows the error.
    writeJson(join(norm, 'problems', 'problem-3.json'), problemRecord({
      id: 3,
      slug: 'three',
      name: 'Three',
      canonicalUrl: '://not-a-valid-url',
    }));
    // ranking entry without bestUserPerLanguage and without a problem record.
    writeJson(join(norm, 'rankings', 'best-submissions.json'), {
      problems: [{ problemId: 8 }],
    });

    const problems = listArchiveExplorerRecords(root, { dataset: 'problems', snapshotId });
    const zero = problems.items.find((i) => i.recordId === '0');
    expect(zero?.mirrorRoute).toBeUndefined();
    const three = problems.items.find((i) => i.recordId === '3');
    expect(three?.subtitle).toBeUndefined();

    const zeroDetail = readArchiveExplorerRecord(root, { dataset: 'problems', recordId: '0', snapshotId });
    expect(zeroDetail.subtitle).toBeUndefined();

    // tests directory does not exist -> empty listing via readJsonDirectory guard.
    const tests = listArchiveExplorerRecords(root, { dataset: 'tests', snapshotId });
    expect(tests.totalCount).toBe(0);

    // ranking detail with no per-problem file and no problem record.
    // Listing the sparse ranking entry exercises the missing-bestUserPerLanguage path.
    const rankingList = listArchiveExplorerRecords(root, { dataset: 'rankings', snapshotId });
    expect(rankingList.items[0]?.subtitle).toBe('No language winners recorded');

    const rankingDetail = readArchiveExplorerRecord(root, {
      dataset: 'rankings',
      recordId: '8',
      snapshotId,
    });
    expect(rankingDetail.title).toBe('Problem #8');
    expect(rankingDetail.mirrorRoute).toBeUndefined();
    expect(rankingDetail.payload).toMatchObject({ problemId: 8 });
  });

  test('handles a ranking index with no problems array', () => {
    const root = makeWorkspace();
    const snapshotId = 'NOPROPS';
    writeCatalog(root, snapshotId);
    const norm = normalizedRoot(root, snapshotId);
    writeJson(join(norm, 'rankings', 'best-submissions.json'), {});

    const summary = getArchiveExplorerSummary(root, { snapshotId });
    expect(summary.datasets.find((d) => d.dataset === 'rankings')?.count).toBe(0);

    const rankings = listArchiveExplorerRecords(root, { dataset: 'rankings', snapshotId });
    expect(rankings.totalCount).toBe(0);

    expect(() =>
      readArchiveExplorerRecord(root, { dataset: 'rankings', recordId: '1', snapshotId }),
    ).toThrow(/was not found/);
  });

  test('reads ranking detail when canonical url is absent (id route)', () => {
    const root = makeWorkspace();
    const snapshotId = 'RANK2';
    writeCatalog(root, snapshotId);
    const norm = normalizedRoot(root, snapshotId);
    writeJson(join(norm, 'rankings', 'best-submissions.json'), {
      problems: [{ problemId: 5, bestUserOverallEvaluationId: 7, bestUserPerLanguage: {} }],
    });
    writeJson(join(norm, 'problems', 'problem-5.json'), problemRecord({
      id: 5,
      slug: 'gamma',
      name: 'Gamma',
      canonicalUrl: undefined,
    }));

    const detail = readArchiveExplorerRecord(root, {
      dataset: 'rankings',
      recordId: '5',
      snapshotId,
    });
    expect(detail.mirrorRoute).toBe('/probleme/5/gamma');
    expect(detail.subtitle).toContain('Best user overall evaluation: 7');
  });
});
