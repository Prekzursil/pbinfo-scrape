import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { createDesktopController } from '../../src/gui/main/desktop-controller.js';
import { initializeWorkspaceState } from '../../src/gui/main/workspace-store.js';
import type { StartDesktopJobInput } from '../../src/gui/main/desktop-controller.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-default-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.local'), { recursive: true });
  initializeWorkspaceState(root, {
    now: new Date('2026-03-10T12:00:00.000Z'),
  });
  return root;
}

describe('desktop controller - defensive default branch', () => {
  test('startJob rejects when given an unrecognized kind that bypasses schema', async () => {
    // The guiJobStartInputSchema validates kind strictly.
    // Passing an unknown kind raises a Zod validation error before reaching
    // the switch default, so this exercises the schema guard path.
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot);

    // Casting to bypass TypeScript; Zod schema will throw before the switch default.
    const unknownInput = { kind: 'not-a-real-kind' } as unknown as StartDesktopJobInput;
    await expect(controller.startJob(unknownInput)).rejects.toThrow();
  });

  test('stopMirrorPreview throws when the job id is not tracked as active', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot);

    await expect(controller.stopMirrorPreview('nonexistent-job-id')).rejects.toThrow(
      /not active/,
    );
  });

  test('resumeJob rejects when the target job is not a crawl kind', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const { createGuiJob } = await import('../../src/gui/main/job-store.js');
    createGuiJob(workspaceRoot, {
      jobId: 'norm-123',
      kind: 'normalize',
      snapshotId: 'snap-1',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const controller = createDesktopController(workspaceRoot);
    await expect(controller.resumeJob('norm-123')).rejects.toThrow(/not resumable/);
  });

  test('getCrawlStatus rethrows non-catalog errors from getCrawlStatusWorkflow', () => {
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot, {
      getCrawlStatusWorkflow: () => {
        throw new Error('unexpected internal error');
      },
    });

    expect(() => controller.getCrawlStatus()).toThrow(/unexpected internal error/);
  });

  test('getCrawlStatus returns null when error message contains was not found in archive/catalog.json', () => {
    const workspaceRoot = createWorkspaceRoot();
    const controller = createDesktopController(workspaceRoot, {
      getCrawlStatusWorkflow: () => {
        throw new Error('snap-xyz was not found in archive/catalog.json');
      },
    });

    expect(controller.getCrawlStatus('snap-xyz')).toBeNull();
  });
});
