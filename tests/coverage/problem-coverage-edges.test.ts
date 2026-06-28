import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  buildProblemCoverageDataset,
  readProblemCoverageIndex,
  readProblemCoverageRecord,
} from '../../src/coverage/problem-coverage.js';
import type {
  EvaluationRecord,
  PageRecord,
  ProblemRecord,
  SourceRecord,
} from '../../src/types/records.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-coverage-edges-'));
  tempDirs.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

function normalizedRoot(workspace: string, snapshotId: string): string {
  return join(workspace, 'archive', 'snapshots', snapshotId, 'normalized');
}

function rawPagesRoot(workspace: string, snapshotId: string): string {
  return join(workspace, 'output', 'artifacts', snapshotId, 'raw-pages');
}

function writeConfig(workspace: string, userHandle?: string): void {
  mkdirSync(join(workspace, '.local'), { recursive: true });
  writeFileSync(
    join(workspace, '.local', 'pbinfo.local.json'),
    JSON.stringify(userHandle ? { crawl: { userHandle } } : {}),
    'utf8',
  );
}

function writeCatalog(workspace: string, snapshotId: string): void {
  writeJson(join(workspace, 'archive', 'catalog.json'), {
    currentSnapshotId: snapshotId,
    canonicalSnapshotId: snapshotId,
    snapshots: [
      {
        snapshotId,
        createdAt: '2026-01-01T00:00:00.000Z',
        scope: 'all',
        status: 'completed',
        checkpoint: 'canonical',
      },
    ],
    artifactExports: [],
  });
}

function problem(overrides: Partial<ProblemRecord> & { id: number }): ProblemRecord {
  return {
    slug: `slug-${overrides.id}`,
    name: `Problem ${overrides.id}`,
    canonicalUrl: `https://www.pbinfo.ro/probleme/${overrides.id}/slug-${overrides.id}`,
    categoryChain: [],
    tags: [],
    sections: [],
    examples: [],
    constraints: [],
    editorialAvailability: 'visible',
    officialSolutions: {},
    visibleTests: [],
    linkedAssets: [],
    metadata: {},
    ...overrides,
  };
}

function evaluation(overrides: Partial<EvaluationRecord> & { evaluationId: number; problemId: number }): EvaluationRecord {
  return {
    problemSlug: `slug-${overrides.problemId}`,
    problemName: `Problem ${overrides.problemId}`,
    language: 'cpp',
    user: 'alice',
    score: 100,
    verdictSummary: 'Accepted',
    sourceAvailable: true,
    suspicionFlags: [],
    tests: [],
    fetchedAt: '2026-01-01T00:00:00.000Z',
    provenance: [],
    ...overrides,
  };
}

function source(overrides: Partial<SourceRecord> & { sourceId: string; problemId: number; kind: SourceRecord['kind'] }): SourceRecord {
  return {
    language: 'cpp',
    sourceAvailable: true,
    suspicionFlags: [],
    provenance: [],
    ...overrides,
  };
}

function page(overrides: Partial<PageRecord> & { url: string; kind: PageRecord['kind'] }): PageRecord {
  return {
    snapshotId: 'SNAP1',
    httpStatus: 200,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('problem-coverage workflow edge branches', () => {
  test('covers fragment, harvest, source, and note branches end to end', async () => {
    const workspace = tempWorkspace();
    const snapshotId = 'SNAP1';
    writeConfig(workspace, 'alice');
    writeCatalog(workspace, snapshotId);
    const norm = normalizedRoot(workspace, snapshotId);
    const raw = rawPagesRoot(workspace, snapshotId);

    // Baseline snapshot with a lower-coverage record for problem 1 so the
    // baseline-present comparison branch is exercised. Fields are intentionally
    // sparse to hit the `?? default` fallbacks.
    writeJson(
      join(workspace, 'archive', 'snapshots', 'acceptance-20260310b', 'normalized', 'problem-coverage', 'index.json'),
      {
        snapshotId: 'acceptance-20260310b',
        generatedAt: '2026-03-10T00:00:00.000Z',
        totals: {},
        records: [
          { problemId: 1, solvedByMe: false },
          { problemId: 11, solvedByMe: false },
        ],
      },
    );

    // Problems exercising mirror-route, editorial, and official-source branches.
    writeJson(join(norm, 'problems', 'problem-1.json'), problem({
      id: 1,
      examples: [{ input: '1', output: '1' }],
      officialSolutions: { cpp: 'int main(){}' },
      sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/slug-1',
    }));
    writeJson(join(norm, 'problems', 'problem-2.json'), problem({
      id: 2,
      canonicalUrl: undefined,
      editorialAvailability: 'restricted',
    }));
    writeJson(join(norm, 'problems', 'problem-3.json'), problem({
      id: 3,
      editorialAvailability: 'hidden',
    }));
    writeJson(join(norm, 'problems', 'problem-4.json'), problem({
      id: 4,
      sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/4/slug-4',
    }));
    writeJson(join(norm, 'problems', 'problem-5.json'), problem({
      id: 5,
      sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/5/slug-5',
    }));
    writeJson(join(norm, 'problems', 'problem-6.json'), problem({ id: 6 }));
    // Problem record omitting optional fields exercises the `?? default` paths
    // for officialSolutions, tags, and editorialAvailability.
    writeJson(join(norm, 'problems', 'problem-12.json'), {
      id: 12,
      slug: 'slug-12',
      name: 'Problem 12',
      canonicalUrl: 'https://www.pbinfo.ro/probleme/12/slug-12',
      categoryChain: [],
      sections: [],
      examples: [],
      constraints: [],
      linkedAssets: [],
      metadata: {},
    });
    // Problem whose own record carries an unfinished official-source harvest with
    // no qualifying evaluation ids -> not-available-upstream via the harvest path.
    writeJson(join(norm, 'problems', 'problem-13.json'), problem({
      id: 13,
      sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/13/slug-13',
      officialSourceHarvest: { sourceListHarvested: true },
    }));
    // Problem solved only via the user-solution feed with no archived artifacts;
    // its counts match the baseline so only the solved-flag improvement applies.
    writeJson(join(norm, 'problems', 'problem-11.json'), problem({ id: 11 }));
    // Unparseable record exercises the readJsonFile catch path.
    writeFileSync(join(norm, 'problems', 'broken.json'), '{ not json', 'utf8');

    // Tests record exercises the testsRecord-present length branches.
    writeJson(join(norm, 'tests', 'problem-1.json'), {
      snapshotId,
      problemId: 1,
      problemSlug: 'slug-1',
      problemName: 'Problem 1',
      examples: [{ testId: 'e1', kind: 'example' }],
      visible: [{ testId: 'v1', kind: 'visible' }],
      evaluationObserved: [{ testId: 'o1', kind: 'evaluationObserved' }],
      effective: [{ testId: 'eff1', kind: 'example' }],
    });

    // Sources: a qualifying official source (with an unrecognized language to hit
    // the normalize fallback), a disqualified official fragment, and a user source.
    writeJson(join(norm, 'sources', 'official-4-cpp.json'), source({
      sourceId: 'official-4-cpp',
      problemId: 4,
      kind: 'official',
      score: 100,
      provenanceType: 'evaluation-detail',
      language: 'brainfuck',
    }));
    writeJson(join(norm, 'sources', 'official-4-frag.json'), source({
      sourceId: 'official-4-frag',
      problemId: 4,
      kind: 'official',
      score: 100,
      provenanceType: 'official-fragment',
    }));
    writeJson(join(norm, 'sources', 'user-1-cpp.json'), source({
      sourceId: 'user-1-cpp',
      problemId: 1,
      kind: 'user-evaluation',
      score: 100,
      userHandle: 'alice',
    }));
    // User source with no handle exercises matchesConfiguredHandle(candidate=undefined).
    writeJson(join(norm, 'sources', 'user-1-nohandle.json'), source({
      sourceId: 'user-1-nohandle',
      problemId: 1,
      kind: 'user-evaluation',
      score: 100,
    }));
    // User source with an undefined language exercises the `language ?? 'unknown'`
    // fallback inside normalizeCoverageLanguage.
    writeJson(join(norm, 'sources', 'user-1-undef.json'), {
      sourceId: 'user-1-undef',
      kind: 'user-evaluation',
      problemId: 1,
      sourceAvailable: true,
      score: 100,
      userHandle: 'alice',
      suspicionFlags: [],
      provenance: [],
    });

    // Evaluations: alice solved problem 1 (cpp), and an unhandled-language eval.
    writeJson(join(norm, 'evaluations', 'evaluation-1001.json'), evaluation({
      evaluationId: 1001,
      problemId: 1,
    }));
    writeJson(join(norm, 'evaluations', 'evaluation-1002.json'), evaluation({
      evaluationId: 1002,
      problemId: 1,
      user: undefined,
      language: '',
    }));

    // User-solution feeds covering the feed/entry branches.
    writeJson(join(norm, 'user-solutions', 'feed-alice.json'), {
      user: 'alice',
      entries: [
        { user: 'alice', evaluationId: 1001, score: 100 },
        { problemId: 6, evaluationId: 9999, score: 100 },
        { problemId: 11, score: 100 },
        { problemId: 7, score: 50 },
        { evaluationId: undefined, problemId: 8, score: 100 },
        { user: 'mallory', problemId: 9, score: 100 },
      ],
    });
    writeJson(join(norm, 'user-solutions', 'feed-bob.json'), {
      user: 'bob',
      entries: [{ problemId: 10, score: 100 }],
    });
    writeJson(join(norm, 'user-solutions', 'feed-empty.json'), { user: 'alice' });

    // Pages: fragments + extractProblemIdFromPage variants.
    writeJson(join(norm, 'pages', 'page-stmt-1.json'), page({
      url: 'https://www.pbinfo.ro/probleme?id=1',
      kind: 'problem-statement',
    }));
    writeJson(join(norm, 'pages', 'page-stmt-noid.json'), page({
      url: 'https://www.pbinfo.ro/probleme',
      kind: 'problem-statement',
    }));
    writeJson(join(norm, 'pages', 'page-sol-1.json'), page({
      url: 'https://www.pbinfo.ro/probleme?id=1',
      kind: 'problem-solution',
    }));
    writeJson(join(norm, 'pages', 'page-public-probleme.json'), page({
      url: 'https://www.pbinfo.ro/probleme/2/beta',
      kind: 'public-page',
    }));
    writeJson(join(norm, 'pages', 'page-public-solutii.json'), page({
      url: 'https://www.pbinfo.ro/solutii/problema/3/foo',
      kind: 'public-page',
    }));
    writeJson(join(norm, 'pages', 'page-public-other.json'), page({
      url: 'https://www.pbinfo.ro/despre',
      kind: 'public-page',
    }));

    // Official-source-list pages exercising every harvest-failure branch.
    mkdirSync(raw, { recursive: true });
    writeFileSync(join(raw, 'harvest5.html'), '<html><body>no rows</body></html>', 'utf8');
    mkdirSync(join(raw, 'isdir.html'), { recursive: true });
    writeJson(join(norm, 'pages', 'page-osl-5.json'), page({
      url: 'https://www.pbinfo.ro/solutii/user/alice/problema/5/foo',
      kind: 'official-source-list',
      bodyPath: 'harvest5.html',
    }));
    writeJson(join(norm, 'pages', 'page-osl-badurl.json'), page({
      url: 'https://www.pbinfo.ro/solutii/user/alice/problema/foo/bar',
      kind: 'official-source-list',
      bodyPath: 'harvest5.html',
    }));
    writeJson(join(norm, 'pages', 'page-osl-nobody.json'), page({
      url: 'https://www.pbinfo.ro/solutii/user/alice/problema/77/x',
      kind: 'official-source-list',
    }));
    writeJson(join(norm, 'pages', 'page-osl-missing.json'), page({
      url: 'https://www.pbinfo.ro/solutii/user/alice/problema/78/x',
      kind: 'official-source-list',
      bodyPath: 'missing.html',
    }));
    writeJson(join(norm, 'pages', 'page-osl-isdir.json'), page({
      url: 'https://www.pbinfo.ro/solutii/user/alice/problema/79/x',
      kind: 'official-source-list',
      bodyPath: 'isdir.html',
    }));

    // Rankings index providing a best-trustworthy language map.
    writeJson(join(norm, 'rankings', 'best-submissions.json'), {
      problems: [
        {
          problemId: 1,
          bestUserOverallEvaluationId: 1001,
          bestUserPerLanguage: { cpp: 1001 },
          bestTrustworthyPerLanguage: { cpp: 1001 },
          bestFastPerLanguage: {},
          bestOfficialPerLanguage: {},
          suspiciousCandidateEvaluationIds: [],
          duplicateEvaluationIds: [],
          orderedUserEvaluationIds: [1001],
        },
      ],
    });

    const result = await buildProblemCoverageDataset(workspace, snapshotId);
    expect(result.problemsCovered).toBe(9);

    const index = readProblemCoverageIndex(norm);
    const byId = new Map(index?.records.map((record) => [record.problemId, record]));

    expect(byId.get(2)?.mirrorRoute).toBe('/probleme/2/slug-2');
    expect(byId.get(2)?.officialSourceBlockedReason).toBe('editorial-restricted');
    expect(byId.get(3)?.officialSourceBlockedReason).toBe('editorial-hidden');
    expect(byId.get(4)?.officialSourceArchived).toBe(true);
    expect(byId.get(4)?.officialSourceBlockedReason).toBeUndefined();
    expect(byId.get(5)?.officialSourceStatus).toBe('not-available-upstream');
    expect(byId.get(1)?.solvedByMe).toBe(true);
    expect(byId.get(1)?.newSinceBaseline).toBe(true);
    expect(byId.get(6)?.solvedByMe).toBe(true);
    expect(byId.get(6)?.notes).toContain(
      'Solved by archived handle, but no normalized evaluation detail is archived yet.',
    );

    const record1 = readProblemCoverageRecord(norm, 1);
    expect(record1?.problemId).toBe(1);
  });

  test('treats unconfigured handle as matching every candidate', async () => {
    const workspace = tempWorkspace();
    const snapshotId = 'SNAP2';
    writeConfig(workspace);
    writeCatalog(workspace, snapshotId);
    const norm = normalizedRoot(workspace, snapshotId);

    writeJson(join(norm, 'problems', 'problem-1.json'), problem({ id: 1 }));
    writeJson(join(norm, 'sources', 'user-1.json'), source({
      sourceId: 'user-1',
      problemId: 1,
      kind: 'user-evaluation',
      score: 100,
      userHandle: 'whoever',
    }));
    writeJson(join(norm, 'evaluations', 'evaluation-1.json'), evaluation({
      evaluationId: 1,
      problemId: 1,
      user: 'whoever',
    }));
    // Rankings file with no problems array exercises the `?? []` iteration guard.
    writeJson(join(norm, 'rankings', 'best-submissions.json'), {});

    const result = await buildProblemCoverageDataset(workspace, snapshotId);
    expect(result.problemsCovered).toBe(1);
    const record = readProblemCoverageRecord(norm, 1);
    expect(record?.userSourceArchived).toBe(true);
    expect(record?.solvedByMe).toBe(true);
  });
});
