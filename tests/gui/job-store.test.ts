import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  appendGuiJobEvent,
  createGuiJob,
  listGuiJobs,
  readGuiJob,
  recoverInterruptedGuiJobs,
  updateGuiJob,
} from '../../src/gui/main/job-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('job store', () => {
  test('persists jobs, counters, and structured log events across reloads', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-gui-jobs-'));
    tempDirs.push(workspaceRoot);

    const created = createGuiJob(workspaceRoot, {
      jobId: 'crawl-job-1',
      kind: 'crawl',
      profileId: 'alpha',
      snapshotId: 'acceptance-20260310b',
      now: new Date('2026-03-10T12:00:00.000Z'),
      detail: {
        scope: 'all',
      },
    });

    appendGuiJobEvent(workspaceRoot, 'crawl-job-1', {
      timestamp: '2026-03-10T12:00:01.000Z',
      level: 'info',
      stage: 'crawl',
      message: 'Processing queue chunk',
      counters: {
        pending: 10,
        completed: 25,
        inProgress: 2,
      },
    });
    updateGuiJob(workspaceRoot, 'crawl-job-1', {
      status: 'running',
      updatedAt: '2026-03-10T12:00:01.000Z',
      latestCounters: {
        pending: 10,
        completed: 25,
        inProgress: 2,
      },
      resumable: true,
    });

    const reloaded = readGuiJob(workspaceRoot, 'crawl-job-1');
    const jobs = listGuiJobs(workspaceRoot);
    const logLines = readFileSync(reloaded.logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { message: string });

    expect(created.status).toBe('queued');
    expect(reloaded.status).toBe('running');
    expect(reloaded.latestCounters).toEqual({
      pending: 10,
      completed: 25,
      inProgress: 2,
    });
    expect(reloaded.resumable).toBe(true);
    expect(jobs).toHaveLength(1);
    expect(logLines).toEqual([
      expect.objectContaining({
        message: 'Processing queue chunk',
      }),
    ]);
    expect(existsSync(reloaded.logPath)).toBe(true);
  });

  test('reopens interrupted running crawl jobs as paused and resumable after restart', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-gui-job-recovery-'));
    tempDirs.push(workspaceRoot);

    createGuiJob(workspaceRoot, {
      jobId: 'crawl-job-1',
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
      now: new Date('2026-03-10T12:00:00.000Z'),
      detail: {
        scope: 'all',
      },
    });
    updateGuiJob(workspaceRoot, 'crawl-job-1', {
      status: 'running',
      updatedAt: '2026-03-10T12:00:10.000Z',
    });

    createGuiJob(workspaceRoot, {
      jobId: 'mirror-job-1',
      kind: 'mirror-serve',
      snapshotId: 'acceptance-20260310b',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });
    updateGuiJob(workspaceRoot, 'mirror-job-1', {
      status: 'completed',
      updatedAt: '2026-03-10T12:00:20.000Z',
    });

    const recovered = recoverInterruptedGuiJobs(workspaceRoot, {
      now: new Date('2026-03-10T12:05:00.000Z'),
    });

    expect(recovered).toEqual([
      expect.objectContaining({
        jobId: 'crawl-job-1',
        status: 'paused',
        resumable: true,
      }),
    ]);
    expect(readGuiJob(workspaceRoot, 'crawl-job-1')).toMatchObject({
      status: 'paused',
      resumable: true,
    });
    expect(readGuiJob(workspaceRoot, 'mirror-job-1')).toMatchObject({
      status: 'completed',
    });
  });
});
