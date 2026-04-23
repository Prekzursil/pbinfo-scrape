import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { materializeTestsForSnapshot } from '../../src/tests-materializer/materialize-tests.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeSnapshot(): {
  snapshotRoot: string;
  normalizedRoot: string;
  layout: ReturnType<typeof prepareSnapshot>;
  workspaceRoot: string;
} {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-materialize-'));
  tempDirs.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
  writeFileSync(
    join(workspaceRoot, '.local', 'pbinfo.local.json'),
    JSON.stringify({ crawl: { userHandle: 'Prekzursil' } }, null, 2),
    'utf8',
  );

  const config = loadLocalConfig(workspaceRoot);
  const layout = prepareSnapshot(config, {
    snapshotId: 'fresh-test',
    scope: 'all',
    now: new Date('2026-04-23T00:00:00.000Z'),
  });
  mkdirSync(join(layout.normalizedRoot, 'problems'), { recursive: true });
  mkdirSync(join(layout.normalizedRoot, 'tests'), { recursive: true });

  return {
    snapshotRoot: layout.snapshotRoot,
    normalizedRoot: layout.normalizedRoot,
    layout,
    workspaceRoot,
  };
}

function writeProblem(normalizedRoot: string, problem: Record<string, unknown>): void {
  writeFileSync(
    join(normalizedRoot, 'problems', `problem-${problem.id}.json`),
    JSON.stringify(problem, null, 2),
    'utf8',
  );
}

function writeTests(normalizedRoot: string, record: Record<string, unknown>): void {
  writeFileSync(
    join(normalizedRoot, 'tests', `problem-${record.problemId}.json`),
    JSON.stringify(record, null, 2),
    'utf8',
  );
}

describe('materializeTestsForSnapshot', () => {
  test('emits a folder with only example cases for a problem that has no visible tests', async () => {
    const { normalizedRoot, layout, snapshotRoot } = makeSnapshot();
    writeProblem(normalizedRoot, {
      id: 1,
      slug: 'sum',
      name: 'sum',
      canonicalUrl: 'https://www.pbinfo.ro/probleme/1/sum',
      categoryChain: [],
      tags: [],
      sections: [],
      examples: [{ input: '1 2', output: '3' }],
      constraints: [],
      editorialAvailability: 'unknown',
      officialSolutions: {},
      visibleTests: [],
      linkedAssets: [],
      metadata: {},
    });

    const result = await materializeTestsForSnapshot(layout, {
      now: new Date('2026-04-23T00:00:00.000Z'),
    });

    expect(result.foldersWritten).toBe(1);
    expect(result.totalCases).toBe(1);
    const folder = join(snapshotRoot, 'tests', '1-sum');
    expect(existsSync(folder)).toBe(true);
    expect(readFileSync(join(folder, '001.in'), 'utf8')).toBe('1 2\n');
    expect(readFileSync(join(folder, '001.ok'), 'utf8')).toBe('3\n');
    const meta = JSON.parse(readFileSync(join(folder, 'meta.json'), 'utf8'));
    expect(meta.caseCount).toBe(1);
    expect(meta.provenanceSummary).toEqual({
      example: 1,
      visible: 0,
      exampleAndVisible: 0,
    });
    expect(existsSync(join(folder, 'tests.json'))).toBe(true);
    expect(existsSync(join(folder, 'README.md'))).toBe(true);
  });

  test('merges and dedupes when example overlaps visible test', async () => {
    const { normalizedRoot, layout, snapshotRoot } = makeSnapshot();
    writeProblem(normalizedRoot, {
      id: 2,
      slug: 'diff',
      name: 'Diff',
      canonicalUrl: 'https://www.pbinfo.ro/probleme/2/diff',
      categoryChain: [],
      tags: [],
      sections: [],
      examples: [{ input: '5 2', output: '3' }],
      constraints: [],
      editorialAvailability: 'unknown',
      officialSolutions: {},
      visibleTests: [],
      linkedAssets: [],
      metadata: {},
    });
    writeTests(normalizedRoot, {
      snapshotId: 'fresh-test',
      problemId: 2,
      problemSlug: 'diff',
      problemName: 'Diff',
      examples: [{ testId: 'example-1', kind: 'example', input: '5 2', output: '3' }],
      visible: [
        { testId: 'visible-1', kind: 'visible', input: '5 2', output: '3', index: 1 },
        { testId: 'visible-2', kind: 'visible', input: '10 3', output: '7', index: 2 },
      ],
      evaluationObserved: [],
    });

    const result = await materializeTestsForSnapshot(layout, {
      now: new Date('2026-04-23T00:00:00.000Z'),
    });

    expect(result.foldersWritten).toBe(1);
    expect(result.totalCases).toBe(2);
    const folder = join(snapshotRoot, 'tests', '2-diff');
    const testsJson = JSON.parse(readFileSync(join(folder, 'tests.json'), 'utf8'));
    expect(testsJson.cases).toHaveLength(2);
    expect(testsJson.cases[0].provenanceKinds).toEqual(['example', 'visible']);
    expect(testsJson.cases[1].provenanceKinds).toEqual(['visible']);
    expect(readFileSync(join(folder, '001.in'), 'utf8')).toBe('5 2\n');
    expect(readFileSync(join(folder, '002.ok'), 'utf8')).toBe('7\n');
  });

  test('does NOT create a folder for a problem with no examples and no visible tests', async () => {
    const { normalizedRoot, layout, snapshotRoot } = makeSnapshot();
    writeProblem(normalizedRoot, {
      id: 3,
      slug: 'empty',
      name: 'Empty',
      canonicalUrl: 'https://www.pbinfo.ro/probleme/3/empty',
      categoryChain: [],
      tags: [],
      sections: [],
      examples: [],
      constraints: [],
      editorialAvailability: 'unknown',
      officialSolutions: {},
      visibleTests: [],
      linkedAssets: [],
      metadata: {},
    });

    const result = await materializeTestsForSnapshot(layout, {
      now: new Date('2026-04-23T00:00:00.000Z'),
    });

    expect(result.foldersWritten).toBe(0);
    expect(result.problemsSkipped).toBe(1);
    expect(result.totalCases).toBe(0);
    expect(existsSync(join(snapshotRoot, 'tests', '3-empty'))).toBe(false);
  });

  test('is idempotent and cleans stale folders on re-run', async () => {
    const { normalizedRoot, layout, snapshotRoot } = makeSnapshot();
    writeProblem(normalizedRoot, {
      id: 4,
      slug: 'mul',
      name: 'Mul',
      canonicalUrl: 'https://www.pbinfo.ro/probleme/4/mul',
      categoryChain: [],
      tags: [],
      sections: [],
      examples: [{ input: '2 3', output: '6' }],
      constraints: [],
      editorialAvailability: 'unknown',
      officialSolutions: {},
      visibleTests: [],
      linkedAssets: [],
      metadata: {},
    });

    await materializeTestsForSnapshot(layout, {
      now: new Date('2026-04-23T00:00:00.000Z'),
    });

    // Pre-existing stale folder (from a previous snapshot run with different slug)
    const staleFolder = join(snapshotRoot, 'tests', '999-gone');
    mkdirSync(staleFolder, { recursive: true });
    writeFileSync(join(staleFolder, '001.in'), 'stale', 'utf8');

    const rerun = await materializeTestsForSnapshot(layout, {
      now: new Date('2026-04-23T00:00:00.000Z'),
    });

    expect(rerun.foldersWritten).toBe(1);
    expect(existsSync(staleFolder)).toBe(false);
    expect(existsSync(join(snapshotRoot, 'tests', '4-mul'))).toBe(true);
    // payloadHash stable across reruns with identical input.
    const firstMeta = JSON.parse(
      readFileSync(join(snapshotRoot, 'tests', '4-mul', 'meta.json'), 'utf8'),
    );
    await materializeTestsForSnapshot(layout, {
      now: new Date('2026-04-23T00:00:00.000Z'),
    });
    const secondMeta = JSON.parse(
      readFileSync(join(snapshotRoot, 'tests', '4-mul', 'meta.json'), 'utf8'),
    );
    expect(firstMeta.payloadHash).toBe(secondMeta.payloadHash);
  });

  test('folder structure contains exactly NNN.in/NNN.ok/tests.json/meta.json/README.md', async () => {
    const { normalizedRoot, layout, snapshotRoot } = makeSnapshot();
    writeProblem(normalizedRoot, {
      id: 5,
      slug: 'abc',
      name: 'ABC',
      canonicalUrl: 'https://www.pbinfo.ro/probleme/5/abc',
      categoryChain: [],
      tags: [],
      sections: [],
      examples: [
        { input: 'a', output: 'A' },
        { input: 'b', output: 'B' },
      ],
      constraints: [],
      editorialAvailability: 'unknown',
      officialSolutions: {},
      visibleTests: [],
      linkedAssets: [],
      metadata: {},
    });

    await materializeTestsForSnapshot(layout, {
      now: new Date('2026-04-23T00:00:00.000Z'),
    });
    const folder = join(snapshotRoot, 'tests', '5-abc');
    const files = readdirSync(folder).sort();
    expect(files).toEqual([
      '001.in',
      '001.ok',
      '002.in',
      '002.ok',
      'README.md',
      'meta.json',
      'tests.json',
    ]);
  });
});
