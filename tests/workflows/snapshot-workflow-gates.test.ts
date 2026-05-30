/**
 * Tests for src/workflows/snapshot-workflow.ts error branches:
 *   - lines 118-121: throws when readProblemCoverageIndex returns undefined
 *   - lines 128-131: throws when officialSourceGate fails (unresolved problems without blocked reason)
 *
 * These paths are reached via vi.doMock to control coverage data returned.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('finalizeSnapshotWorkflow coverage-index-missing gate (lines 118-121)', () => {
  test('throws when readProblemCoverageIndex returns undefined after full pipeline', async () => {
    vi.resetModules();

    // Mock readProblemCoverageIndex to return undefined regardless of what buildProblemCoverageDataset writes
    vi.doMock('../../src/coverage/problem-coverage.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/coverage/problem-coverage.js')>(
        '../../src/coverage/problem-coverage.js',
      );
      return {
        ...actual,
        readProblemCoverageIndex: () => undefined,
      };
    });

    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const workspaceRoot = (actualFs as typeof import('node:fs')).mkdtempSync(
      join(tmpdir(), 'pbinfo-snap-nocov-'),
    );
    tempDirs.push(workspaceRoot);

    const { prepareSnapshot } = await import(
      '../../src/archive/storage.js'
    );
    const { loadLocalConfig } = await import('../../src/config/local-config.js');
    const { finalizeSnapshotWorkflow } = await import(
      '../../src/workflows/snapshot-workflow.js'
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'nocov-snap',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    // Set up just enough for the pipeline to pass through normalize/rank/mirror:
    // empty normalized pages directory and raw pages manifest
    (actualFs as typeof import('node:fs')).mkdirSync(
      join(snapshot.normalizedRoot, 'pages'),
      { recursive: true },
    );
    (actualFs as typeof import('node:fs')).writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({}),
      'utf8',
    );
    (actualFs as typeof import('node:fs')).writeFileSync(
      snapshot.rawAssetsManifestPath,
      JSON.stringify({}),
      'utf8',
    );

    await expect(
      finalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId),
    ).rejects.toThrow(/Coverage dataset is missing/);
  });
});

describe('finalizeSnapshotWorkflow officialSourceGate failure (lines 128-131)', () => {
  test('throws when officialSourceGate fails due to unresolved problems', async () => {
    vi.resetModules();

    // Mock readProblemCoverageIndex to return a minimal index so we get past the null-check,
    // then mock buildProblemCoverageGapReport to return a failed officialSourceGate
    vi.doMock('../../src/coverage/problem-coverage.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/coverage/problem-coverage.js')>(
        '../../src/coverage/problem-coverage.js',
      );
      return {
        ...actual,
        readProblemCoverageIndex: () => ({
          snapshotId: 'offgate-snap',
          generatedAt: '2026-03-10T00:00:00.000Z',
          totals: {
            totalProblems: 0,
            solvedByMeCount: 0,
            completeProblemCount: 0,
            incompleteSolvedProblemCount: 0,
            missingOfficialSourceCaptureCount: 0,
            officialSourceUnavailableUpstreamCount: 0,
            missingTestsCaptureCount: 0,
            testsUnavailableUpstreamCount: 0,
            statementArchivedCount: 0,
            solutionFragmentArchivedCount: 0,
            testsFragmentArchivedCount: 0,
            problemsWithExamples: 0,
            problemsWithVisibleTestsCaptured: 0,
            problemsWithEvaluationObservedTests: 0,
            problemsWithEffectiveTests: 0,
            problemsWithArchivedSources: 0,
            problemsWithOfficialSourceArchived: 0,
            problemsWithUserSourceArchived: 0,
            editorialVisibleCount: 0,
            rankingPresentCount: 0,
            newSinceBaselineCount: 0,
          },
          records: [],
        }),
      };
    });

    // Mock buildProblemCoverageGapReport to return a failed officialSourceGate
    vi.doMock('../../src/coverage/coverage-gaps.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/coverage/coverage-gaps.js')>(
        '../../src/coverage/coverage-gaps.js',
      );
      return {
        ...actual,
        buildProblemCoverageGapReport: (options: Parameters<typeof actual.buildProblemCoverageGapReport>[0]) => {
          const real = actual.buildProblemCoverageGapReport(options);
          return {
            ...real,
            gates: {
              ...real.gates,
              officialSourceGate: {
                passed: false,
                failedProblemIds: [99001],
                failureCount: 1,
              },
            },
          };
        },
      };
    });

    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const workspaceRoot = (actualFs as typeof import('node:fs')).mkdtempSync(
      join(tmpdir(), 'pbinfo-snap-offgate-'),
    );
    tempDirs.push(workspaceRoot);

    const { prepareSnapshot } = await import('../../src/archive/storage.js');
    const { loadLocalConfig } = await import('../../src/config/local-config.js');
    const { finalizeSnapshotWorkflow } = await import(
      '../../src/workflows/snapshot-workflow.js'
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'offgate-snap',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    (actualFs as typeof import('node:fs')).mkdirSync(
      join(snapshot.normalizedRoot, 'pages'),
      { recursive: true },
    );
    (actualFs as typeof import('node:fs')).writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({}),
      'utf8',
    );
    (actualFs as typeof import('node:fs')).writeFileSync(
      snapshot.rawAssetsManifestPath,
      JSON.stringify({}),
      'utf8',
    );

    await expect(
      finalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId),
    ).rejects.toThrow(/Coverage hard gate failed \(official sources\)/);
  });
});
