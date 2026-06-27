import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  createGuiJob,
  listGuiJobs,
  readGuiJobEvents,
} from '../../src/gui/main/job-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pbinfo-jobs-edge-'));
  tempDirs.push(dir);
  return dir;
}

describe('job store edge cases', () => {
  test('listGuiJobs returns an empty list when no jobs directory exists yet', () => {
    expect(listGuiJobs(makeWorkspace())).toEqual([]);
  });

  test('readGuiJobEvents returns an empty list when the log file was removed', () => {
    const workspaceRoot = makeWorkspace();
    const job = createGuiJob(workspaceRoot, { jobId: 'job-1', kind: 'crawl' });
    rmSync(job.logPath, { force: true });
    expect(readGuiJobEvents(workspaceRoot, 'job-1')).toEqual([]);
  });
});
