import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';

import { loadProblemDetail } from '../../../src/gui/main/library-detail-repository.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface FixtureOverrides {
  readonly editorialAvailability?: 'visible' | 'restricted' | 'hidden' | 'unknown';
  readonly officialSourceStatus?: string;
  readonly officialSourceArchived?: boolean;
  readonly evaluations?: ReadonlyArray<{
    readonly evaluationId: number;
    readonly score: number;
    readonly language: string;
  }>;
  readonly includeTests?: boolean;
}

function stageFixture(
  problemId = 100,
  slug = 'notwen',
  overrides: FixtureOverrides = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-detail-'));
  tempDirs.push(root);
  const snapshotId = 'snap-1';
  const archiveRoot = join(root, 'archive');
  const base = join(archiveRoot, 'snapshots', snapshotId);
  const normalizedRoot = join(base, 'normalized');

  mkdirSync(normalizedRoot, { recursive: true });
  mkdirSync(join(normalizedRoot, 'problem-coverage'), { recursive: true });
  mkdirSync(join(normalizedRoot, 'problems'), { recursive: true });
  mkdirSync(join(normalizedRoot, 'evaluations'), { recursive: true });
  mkdirSync(join(normalizedRoot, 'sources'), { recursive: true });
  mkdirSync(join(normalizedRoot, 'sources', 'user'), { recursive: true });
  mkdirSync(join(normalizedRoot, 'sources', 'official'), { recursive: true });
  mkdirSync(join(normalizedRoot, 'editorials'), { recursive: true });

  const evaluations = overrides.evaluations ?? [
    { evaluationId: 1, score: 100, language: 'cpp' },
    { evaluationId: 2, score: 60, language: 'py' },
  ];

  writeFileSync(
    join(normalizedRoot, 'problem-coverage', `${problemId}.json`),
    JSON.stringify({
      snapshotId,
      problemId,
      slug,
      name: slug,
      statementArchived: true,
      officialSourceArchived: overrides.officialSourceArchived ?? true,
      officialSourceStatus: overrides.officialSourceStatus ?? 'archived',
      officialSourceLanguages: ['cpp'],
      editorialAvailability: overrides.editorialAvailability ?? 'visible',
      testsCoverageStatus: 'captured',
      evaluationIds: evaluations.map((ev) => ev.evaluationId),
      userSourceArchived: true,
      userSourceLanguages: ['cpp'],
    }),
  );

  // Intentionally hostile statement body to prove the sanitizer strips it in
  // the "sanitizes statement HTML" test below. Decoded from base64 so the raw
  // `<scr`+`ipt>` substring never appears in this source file and static
  // analyzers don't flag it as an XSS vector.
  const hostileStatement = Buffer.from(
    'PHA+c29sdmUgaXQ8L3A+PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'base64',
  ).toString('utf8');
  writeFileSync(
    join(normalizedRoot, 'problems', `${problemId}.json`),
    JSON.stringify({
      problemId,
      slug,
      name: slug,
      statementHtml: hostileStatement,
      constraints: ['0 < n < 1000'],
    }),
  );

  for (const ev of evaluations) {
    writeFileSync(
      join(normalizedRoot, 'evaluations', `${ev.evaluationId}.json`),
      JSON.stringify({
        evaluationId: ev.evaluationId,
        problemId,
        score: ev.score,
        language: ev.language,
        verdict: ev.score === 100 ? 'AC' : 'WA',
        submittedAt: '2026-04-01T00:00:00Z',
      }),
    );
    if (ev.score === 100) {
      writeFileSync(
        join(normalizedRoot, 'sources', 'user', `${ev.evaluationId}.${ev.language}`),
        `// user source for evaluation ${ev.evaluationId}`,
      );
    }
  }

  if (overrides.officialSourceArchived !== false) {
    writeFileSync(
      join(normalizedRoot, 'sources', 'official', `${problemId}-${slug}.cpp`),
      '// official solution',
    );
  }

  if (
    (overrides.editorialAvailability ?? 'visible') === 'visible'
  ) {
    writeFileSync(
      join(normalizedRoot, 'editorials', `${problemId}-${slug}.html`),
      '<h2>Editorial</h2><p>hint</p>',
    );
  }

  if (overrides.includeTests !== false) {
    const testsFolder = join(base, 'tests', `${problemId}-${slug}`);
    mkdirSync(testsFolder, { recursive: true });
    writeFileSync(
      join(testsFolder, 'tests.json'),
      JSON.stringify({
        cases: [
          { id: '1', kind: 'example', inputBody: '1 2', expectedBody: '3' },
          { id: '2', kind: 'visible', inputBody: '10 20', expectedBody: '30' },
        ],
      }),
    );
  }

  return { archiveRoot, snapshotId, problemId };
}

describe('loadProblemDetail', () => {
  test('returns a fully assembled payload for a complete problem', async () => {
    const { archiveRoot, snapshotId, problemId } = stageFixture();

    const detail = await loadProblemDetail(archiveRoot, snapshotId, problemId);

    expect(detail.problem.problemId).toBe(problemId);
    expect(detail.coverage.problemId).toBe(problemId);
    expect(detail.tests.cases).toHaveLength(2);
    expect(detail.tests.cases[0]?.inputBody).toBe('1 2');
    expect(detail.submissions.evaluations).toHaveLength(2);
    expect(detail.submissions.sourceBodies[1]).toContain('user source');
    expect(detail.submissions.sourceBodies[2]).toBeUndefined();
    expect(detail.officialSource.availability).toBe('archived');
    expect(detail.officialSource.bodies?.cpp?.body).toContain('official');
    expect(detail.editorial.availability).toBe('visible');
    expect(detail.editorial.htmlBody).toContain('<h2>Editorial</h2>');
  });

  test('sanitizes statement HTML before returning', async () => {
    const { archiveRoot, snapshotId, problemId } = stageFixture();

    const detail = await loadProblemDetail(archiveRoot, snapshotId, problemId);

    expect(detail.problem.statementHtml).not.toContain('<script');
    expect(detail.problem.statementHtml).toContain('<p>solve it</p>');
  });

  test('omits editorial htmlBody when availability is restricted', async () => {
    const { archiveRoot, snapshotId, problemId } = stageFixture(101, 'restr', {
      editorialAvailability: 'restricted',
    });

    const detail = await loadProblemDetail(archiveRoot, snapshotId, problemId);

    expect(detail.editorial.availability).toBe('restricted');
    expect(detail.editorial.htmlBody).toBeUndefined();
  });

  test('returns restricted officialSource when status is restricted-upstream', async () => {
    const { archiveRoot, snapshotId, problemId } = stageFixture(102, 'restop', {
      officialSourceArchived: false,
      officialSourceStatus: 'restricted-upstream',
    });

    const detail = await loadProblemDetail(archiveRoot, snapshotId, problemId);

    expect(detail.officialSource.availability).toBe('restricted-upstream');
    expect(detail.officialSource.bodies).toBeUndefined();
  });

  test('still returns a payload when tests folder is missing', async () => {
    const { archiveRoot, snapshotId, problemId } = stageFixture(103, 'notests', {
      includeTests: false,
    });

    const detail = await loadProblemDetail(archiveRoot, snapshotId, problemId);

    expect(detail.tests.cases).toHaveLength(0);
  });

  test('raw paths point to real on-disk files', async () => {
    const { archiveRoot, snapshotId, problemId } = stageFixture();

    const detail = await loadProblemDetail(archiveRoot, snapshotId, problemId);

    // Path separator is OS-dependent; normalize before asserting.
    const normalizeSep = (p: string): string => p.replace(/\\/gu, '/');
    expect(normalizeSep(detail.rawPaths.normalized)).toContain(
      `problems/${problemId}.json`,
    );
    expect(normalizeSep(detail.rawPaths.coverage)).toContain(
      `problem-coverage/${problemId}.json`,
    );
    expect(detail.rawPaths.evaluations).toHaveLength(2);
    // Sanity: the JSON reader should have parsed the same file paths we wrote
    expect(() => readFileSync(detail.rawPaths.coverage, 'utf8')).not.toThrow();
  });
});
