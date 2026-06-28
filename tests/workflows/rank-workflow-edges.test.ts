import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { runRankingWorkflow } from '../../src/workflows/rank-workflow.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(localConfig?: Record<string, unknown>): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-ranking-edge-'));
  tempDirs.push(workspaceRoot);
  if (localConfig) {
    const localRoot = join(workspaceRoot, '.local');
    mkdirSync(localRoot, { recursive: true });
    writeFileSync(join(localRoot, 'pbinfo.local.json'), JSON.stringify(localConfig), 'utf8');
  }
  return workspaceRoot;
}

describe('runRankingWorkflow edge cases', () => {
  test('handles a missing evaluations directory and sources without code or flags', async () => {
    const workspaceRoot = makeWorkspace();
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'edge-1',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const sourcesRoot = join(snapshot.normalizedRoot, 'sources');
    mkdirSync(sourcesRoot, { recursive: true });
    writeFileSync(
      join(sourcesRoot, 'official-7000.json'),
      JSON.stringify({
        sourceId: 'official-7000',
        kind: 'official',
        problemId: 7000,
        language: 'cpp',
        score: 100,
        sourceAvailable: false,
        provenanceType: 'official-evaluation',
        provenance: ['official'],
      }),
      'utf8',
    );

    const result = await runRankingWorkflow(workspaceRoot);

    expect(result.problemsRanked).toBe(1);
    const summary = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'rankings', 'best-submissions.json'), 'utf8'),
    ) as { problems: Array<{ problemId: number; orderedUserEvaluationIds: number[] }> };
    expect(summary.problems[0]?.problemId).toBe(7000);
    expect(summary.problems[0]?.orderedUserEvaluationIds).toEqual([]);
  });

  test('filters out evaluations whose user does not match the configured handle', async () => {
    const workspaceRoot = makeWorkspace({ crawl: { userHandle: 'Prekzursil' } });
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'edge-2',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const evaluationsRoot = join(snapshot.normalizedRoot, 'evaluations');
    mkdirSync(evaluationsRoot, { recursive: true });
    const base = {
      problemId: 555,
      problemName: 'p',
      problemSlug: 'p',
      language: 'cpp',
      score: 100,
      verdictSummary: 'OK.',
      sourceAvailable: true,
      sourceCode: 'int main(){}',
      suspicionFlags: [],
      tests: [],
      fetchedAt: '2026-03-10T00:00:00.000Z',
      provenance: ['user-solutions'],
    };
    writeFileSync(
      join(evaluationsRoot, 'anon.json'),
      JSON.stringify({ ...base, evaluationId: 1 }),
      'utf8',
    );
    writeFileSync(
      join(evaluationsRoot, 'mine.json'),
      JSON.stringify({ ...base, evaluationId: 2, user: 'Prekzursil' }),
      'utf8',
    );

    const result = await runRankingWorkflow(workspaceRoot);

    const summary = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'rankings', 'best-submissions.json'), 'utf8'),
    ) as { problems: Array<{ orderedUserEvaluationIds: number[] }> };
    expect(summary.problems[0]?.orderedUserEvaluationIds).toEqual([2]);
    expect(result.problemsRanked).toBe(1);
  });
});
