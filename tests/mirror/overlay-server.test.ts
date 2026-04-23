import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import express from 'express';
import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import {
  buildOverlayForProblem,
  registerOverlayServerRoute,
} from '../../src/mirror/overlay-server.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface MinimalCoverageRecord {
  snapshotId: string;
  problemId: number;
  slug: string;
  name: string;
  mirrorRoute: string;
  tags: string[];
  solvedByMe: boolean;
  evaluationCount: number;
  solvedEvaluationCount: number;
  rankingPresent: boolean;
  statementArchived: boolean;
  solutionFragmentArchived: boolean;
  testsFragmentArchived: boolean;
  exampleTestsAvailableCount: number;
  visibleTestsCapturedCount: number;
  officialSolutionPresent: boolean;
  editorialAvailability: 'visible' | 'restricted' | 'hidden' | 'unknown';
  officialSourceArchived: boolean;
  officialSourceCount: number;
  officialSourceIds: string[];
  userSourceArchived: boolean;
  userSourceCount: number;
  userSourceIds: string[];
  evaluationIds: number[];
  notes: string[];
  [key: string]: unknown;
}

function setupSnapshotWithCoverage(
  problemCoverageRecords: MinimalCoverageRecord[],
): ReturnType<typeof prepareSnapshot> {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-overlay-'));
  tempDirs.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
  writeFileSync(
    join(workspaceRoot, '.local', 'pbinfo.local.json'),
    JSON.stringify({ crawl: { userHandle: 'Prekzursil' } }, null, 2),
    'utf8',
  );
  const config = loadLocalConfig(workspaceRoot);
  const snapshot = prepareSnapshot(config, {
    snapshotId: 'overlay-test',
    scope: 'all',
    now: new Date('2026-04-23T00:00:00.000Z'),
  });
  const coverageRoot = join(snapshot.normalizedRoot, 'problem-coverage');
  mkdirSync(coverageRoot, { recursive: true });
  for (const record of problemCoverageRecords) {
    writeFileSync(
      join(coverageRoot, `problem-${record.problemId}.json`),
      JSON.stringify(record, null, 2),
      'utf8',
    );
  }
  return snapshot;
}

describe('buildOverlayForProblem', () => {
  test('returns compact overlay for a solved problem with evaluation timeline', () => {
    const snapshot = setupSnapshotWithCoverage([
      {
        snapshotId: 'overlay-test',
        problemId: 42,
        slug: 'maxchain',
        name: 'MaxChain',
        canonicalUrl: 'https://www.pbinfo.ro/probleme/42/maxchain',
        mirrorRoute: '/probleme/42/maxchain',
        tags: [],
        solvedByMe: true,
        evaluationCount: 3,
        solvedEvaluationCount: 1,
        rankingPresent: true,
        statementArchived: true,
        solutionFragmentArchived: true,
        testsFragmentArchived: true,
        exampleTestsAvailableCount: 2,
        visibleTestsCapturedCount: 1,
        officialSolutionPresent: true,
        editorialAvailability: 'visible',
        officialSourceArchived: true,
        officialSourceCount: 1,
        officialSourceIds: ['official-1'],
        officialSourceLanguages: ['cpp'],
        userSourceArchived: true,
        userSourceCount: 1,
        userSourceIds: ['user-42-cpp'],
        userSourceLanguages: ['cpp'],
        trustworthyUserSourceLanguages: ['cpp'],
        missingTrustworthyUserSourceLanguages: [],
        testsCoverageStatus: 'captured',
        evaluationIds: [520, 510, 500],
        progressState: 'solved',
        bestScore: 100,
        lastAttemptAt: '2026-03-09T10:00:00.000Z',
        languagesTried: ['cpp', 'py'],
        evaluationTimeline: [
          {
            evaluationId: 520,
            language: 'py',
            score: 100,
            verdictSummary: 'accepted',
            fetchedAt: '2026-03-09T10:00:00.000Z',
            sourceAvailable: true,
          },
        ],
        notes: [],
      },
    ]);

    const overlay = buildOverlayForProblem(snapshot, 42, new Date('2026-04-23T00:00:00.000Z'));
    expect(overlay).not.toBeNull();
    expect(overlay?.problemId).toBe(42);
    expect(overlay?.slug).toBe('maxchain');
    expect(overlay?.progressState).toBe('solved');
    expect(overlay?.bestScore).toBe(100);
    expect(overlay?.officialSourceLanguages).toEqual(['cpp']);
    expect(overlay?.trustworthyLanguages).toEqual(['cpp']);
    expect(overlay?.testsCaptured).toBe(true);
    expect(overlay?.latestTimelineEntry?.evaluationId).toBe(520);
    expect(overlay?.latestTimelineEntry?.sourceAvailable).toBe(true);
    expect(overlay?.generatedAt).toBe('2026-04-23T00:00:00.000Z');
  });

  test('derives progressState from solvedByMe + evaluationCount when not explicit', () => {
    const snapshot = setupSnapshotWithCoverage([
      {
        snapshotId: 'overlay-test',
        problemId: 7,
        slug: 'partial',
        name: 'Partial',
        mirrorRoute: '/probleme/7/partial',
        tags: [],
        solvedByMe: false,
        evaluationCount: 4,
        solvedEvaluationCount: 0,
        rankingPresent: false,
        statementArchived: true,
        solutionFragmentArchived: false,
        testsFragmentArchived: false,
        exampleTestsAvailableCount: 0,
        visibleTestsCapturedCount: 0,
        officialSolutionPresent: false,
        editorialAvailability: 'unknown',
        officialSourceArchived: false,
        officialSourceCount: 0,
        officialSourceIds: [],
        userSourceArchived: false,
        userSourceCount: 0,
        userSourceIds: [],
        evaluationIds: [1, 2, 3, 4],
        notes: [],
      },
    ]);
    const overlay = buildOverlayForProblem(snapshot, 7);
    expect(overlay?.progressState).toBe('partial');
  });

  test('returns not-attempted when no evaluations exist', () => {
    const snapshot = setupSnapshotWithCoverage([
      {
        snapshotId: 'overlay-test',
        problemId: 11,
        slug: 'untried',
        name: 'Untried',
        mirrorRoute: '/probleme/11/untried',
        tags: [],
        solvedByMe: false,
        evaluationCount: 0,
        solvedEvaluationCount: 0,
        rankingPresent: false,
        statementArchived: true,
        solutionFragmentArchived: false,
        testsFragmentArchived: false,
        exampleTestsAvailableCount: 0,
        visibleTestsCapturedCount: 0,
        officialSolutionPresent: false,
        editorialAvailability: 'hidden',
        officialSourceArchived: false,
        officialSourceCount: 0,
        officialSourceIds: [],
        userSourceArchived: false,
        userSourceCount: 0,
        userSourceIds: [],
        evaluationIds: [],
        notes: [],
      },
    ]);
    const overlay = buildOverlayForProblem(snapshot, 11);
    expect(overlay?.progressState).toBe('not-attempted');
  });

  test('returns null when no coverage record exists', () => {
    const snapshot = setupSnapshotWithCoverage([]);
    expect(buildOverlayForProblem(snapshot, 999)).toBeNull();
  });
});

describe('registerOverlayServerRoute', () => {
  test('responds with overlay JSON when problemId is valid', async () => {
    const snapshot = setupSnapshotWithCoverage([
      {
        snapshotId: 'overlay-test',
        problemId: 1,
        slug: 'sum',
        name: 'sum',
        mirrorRoute: '/probleme/1/sum',
        tags: [],
        solvedByMe: true,
        evaluationCount: 1,
        solvedEvaluationCount: 1,
        rankingPresent: false,
        statementArchived: true,
        solutionFragmentArchived: false,
        testsFragmentArchived: false,
        exampleTestsAvailableCount: 1,
        visibleTestsCapturedCount: 0,
        officialSolutionPresent: false,
        editorialAvailability: 'visible',
        officialSourceArchived: false,
        officialSourceCount: 0,
        officialSourceIds: [],
        userSourceArchived: false,
        userSourceCount: 0,
        userSourceIds: [],
        evaluationIds: [100],
        notes: [],
      },
    ]);
    const app = express();
    registerOverlayServerRoute(app, snapshot);

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.on('error', reject);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('server address unavailable');
      }
      const response = await fetch(
        `http://127.0.0.1:${address.port}/__pbinfo-overlay.json?problemId=1`,
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.problemId).toBe(1);
      expect(payload.slug).toBe('sum');
      expect(payload.progressState).toBe('solved');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('responds 400 when problemId is missing or non-numeric', async () => {
    const snapshot = setupSnapshotWithCoverage([]);
    const app = express();
    registerOverlayServerRoute(app, snapshot);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.on('error', reject);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('server address unavailable');
      }
      const response = await fetch(
        `http://127.0.0.1:${address.port}/__pbinfo-overlay.json?problemId=abc`,
      );
      expect(response.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('responds 404 when the problem is not in the coverage index', async () => {
    const snapshot = setupSnapshotWithCoverage([]);
    const app = express();
    registerOverlayServerRoute(app, snapshot);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.on('error', reject);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('server address unavailable');
      }
      const response = await fetch(
        `http://127.0.0.1:${address.port}/__pbinfo-overlay.json?problemId=999`,
      );
      expect(response.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
