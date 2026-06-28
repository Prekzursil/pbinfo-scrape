import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { prepareSnapshot, type SnapshotLayout } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { persistProblemExamples, persistProblemVisibleTests } from '../../src/crawl/archive-crawler.js';
import type { ProblemTestsRecord } from '../../src/types/records.js';

const tempDirs: string[] = [];
let snapshot: SnapshotLayout;

beforeEach(() => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-persist-tests-'));
  tempDirs.push(workspaceRoot);
  const config = loadLocalConfig(workspaceRoot);
  snapshot = prepareSnapshot(config, { scope: 'all', snapshotId: 'persist', now: new Date('2026-03-10T00:00:00.000Z') });
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readTests(problemId: number): ProblemTestsRecord {
  return JSON.parse(
    readFileSync(join(snapshot.normalizedRoot, 'tests', `problem-${problemId}.json`), 'utf8'),
  ) as ProblemTestsRecord;
}

describe('persistProblemExamples', () => {
  test('drops empty example input/output to undefined', () => {
    persistProblemExamples(snapshot, 7, 'sum', 'Sum', [
      { input: '', output: '', explanation: 'edge' },
      { input: '5', output: '10' },
    ]);
    const record = readTests(7);
    expect(record.examples[0]?.input).toBeUndefined();
    expect(record.examples[0]?.output).toBeUndefined();
    expect(record.examples[1]?.input).toBe('5');
  });
});

describe('persistProblemVisibleTests', () => {
  test('falls back to a generated label when the title is empty', () => {
    persistProblemVisibleTests(snapshot, 9, 'dif', 'Diff', [
      { title: '', input: '', output: '', score: 10 },
      { title: 'Named', input: '3', output: '4' },
    ]);
    const record = readTests(9);
    expect(record.visible[0]?.label).toBe('Visible test 1');
    expect(record.visible[0]?.input).toBeUndefined();
    expect(record.visible[1]?.label).toBe('Named');
  });
});
