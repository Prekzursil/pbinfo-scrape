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
  writeJson(
    join(normalizedRoot, 'rankings', 'best-submissions.json'),
    {
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
    },
  );
  writeJson(
    join(normalizedRoot, 'rankings', 'problems', 'problem-101.json'),
    { problemId: 101, bestUserPerLanguage: { cpp: 5001 } },
  );

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
    writeJson(join(mirrorRoot, 'routes.json'), [makeRoute(), makeRoute({ route: '/probleme/202/produs' })]);

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

    expect(() => getArchiveExplorerSummary(workspaceRoot)).toThrow('No archived snapshot is available.');
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
    expect(listing.items[0].subtitle).toBe('/probleme/101/suma');
    expect(listing.items[0].description).toBe('1 <= n <= 100 • 0 <= a <= 1000');
    // Problem 202 has no canonicalUrl, so route is derived from id/slug.
    expect(listing.items[1].mirrorRoute).toBe('/probleme/202/produs');
    expect(listing.items[1].subtitle).toBeUndefined();
    expect(listing.items[1].description).toBeUndefined();
  });

  test('lists evaluations sorted descending', () => {
    const { workspaceRoot } = seedWorkspace();

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'evaluations',
    });

    expect(listing.items.map((item) => item.recordId)).toEqual(['5002', '5001']);
    expect(listing.items[1].mirrorRoute).toBe('/detalii-evaluare/5001');
  });

  test('lists tests records', () => {
    const { workspaceRoot } = seedWorkspace();

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'tests',
    });

    expect(listing.items).toHaveLength(1);
    expect(listing.items[0].mirrorRoute).toBe('/probleme/101/suma');
    expect(listing.items[0].subtitle).toContain('examples: 0');
  });

  test('lists rankings with problem names and language winners', () => {
    const { workspaceRoot } = seedWorkspace();

    const listing = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'rankings',
    });

    expect(listing.items.map((item) => item.recordId)).toEqual(['101', '303']);
    const first = listing.items[0];
    expect(first.title).toBe('#101 Suma a doua numere');
    expect(first.subtitle).toContain('Best user languages: cpp');
    expect(first.description).toContain('5001');
    // Problem 303 has no problem record and no winners/overall best.
    const second = listing.items[1];
    expect(second.title).toBe('Problem #303');
    expect(second.subtitle).toBe('No language winners recorded');
    expect(second.description).toBe('No overall best user evaluation recorded');
    expect(second.mirrorRoute).toBeUndefined();
  });

  test('lists mirror routes from the manifest and applies query filtering', () => {
    const { workspaceRoot, mirrorRoot } = seedWorkspace();
    writeJson(join(mirrorRoot, 'routes.json'), [
      makeRoute(),
      makeRoute({ route: '/detalii-evaluare/5001', template: 'evaluation', sourceUrl: undefined, entityKey: 'eval:5001' }),
    ]);

    const all = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'mirror-routes',
    });
    expect(all.items.map((item) => item.recordId)).toEqual([
      '/detalii-evaluare/5001',
      '/probleme/101/suma',
    ]);
    expect(all.items[0].description).toBe('eval:5001');

    const filtered = listArchiveExplorerRecords(workspaceRoot, {
      snapshotId: SNAPSHOT_ID,
      dataset: 'mirror-routes',
      query: 'detalii',
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].recordId).toBe('/detalii-evaluare/5001');
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
    expect(listing.items[0].recordId).toBe('/from-dir');
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
