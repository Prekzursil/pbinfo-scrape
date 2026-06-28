import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.resetModules();
  const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
  for (const dir of tempDirs.splice(0)) {
    actualFs.rmSync(dir, { recursive: true, force: true });
  }
});

async function makeWorkspace(snapshotId: string): Promise<{
  workspaceRoot: string;
  snapshot: Awaited<ReturnType<typeof import('../../src/archive/storage.js')['prepareSnapshot']>>;
  fs: typeof import('node:fs');
}> {
  const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
  const workspaceRoot = actualFs.mkdtempSync(join(tmpdir(), 'pbinfo-normalize-edges-'));
  tempDirs.push(workspaceRoot);
  const { prepareSnapshot } = await import('../../src/archive/storage.js');
  const { loadLocalConfig } = await import('../../src/config/local-config.js');
  const config = loadLocalConfig(workspaceRoot);
  const snapshot = prepareSnapshot(config, {
    snapshotId,
    scope: 'all',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });
  return { workspaceRoot, snapshot, fs: actualFs };
}

describe('runNormalizeSnapshotWorkflow edges', () => {
  test('skips pages without a raw-pages body or with a missing html file', async () => {
    const { workspaceRoot, snapshot, fs } = await makeWorkspace('normalize-skip');
    fs.mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    fs.writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'a.json'),
      JSON.stringify({ url: 'https://x/1', kind: 'public-page', httpStatus: 200, fetchedAt: 't', bodyPath: 'elsewhere/a.html' }),
      'utf8',
    );
    fs.writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'b.json'),
      JSON.stringify({ url: 'https://x/2', kind: 'public-page', httpStatus: 200, fetchedAt: 't', bodyPath: 'raw-pages/missing.html' }),
      'utf8',
    );

    const { runNormalizeSnapshotWorkflow } = await import('../../src/workflows/normalize-workflow.js');
    const result = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId);
    expect(result.pagesNormalized).toBe(0);
  });

  test('returns empty page records when the pages directory is missing', async () => {
    const { workspaceRoot, snapshot } = await makeWorkspace('normalize-no-pages');
    const { runNormalizeSnapshotWorkflow } = await import('../../src/workflows/normalize-workflow.js');
    const result = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId);
    expect(result.pagesNormalized).toBe(0);
  });

  test('rethrows a non-retryable, non-Error removal failure', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const workspaceRoot = actualFs.mkdtempSync(join(tmpdir(), 'pbinfo-normalize-nonerror-'));
    tempDirs.push(workspaceRoot);
    vi.resetModules();

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        rmSync(target: Parameters<typeof actual.rmSync>[0], options?: Parameters<typeof actual.rmSync>[1]) {
          if (String(target).endsWith(`${sep}problems${sep}stale.json`)) {
            throw 'not-an-error-instance';
          }
          return actual.rmSync(target, options);
        },
      };
    });

    const { prepareSnapshot } = await import('../../src/archive/storage.js');
    const { loadLocalConfig } = await import('../../src/config/local-config.js');
    const { runNormalizeSnapshotWorkflow } = await import('../../src/workflows/normalize-workflow.js');
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, { snapshotId: 'normalize-nonerror', scope: 'all', now: new Date() });
    actualFs.mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    actualFs.writeFileSync(join(snapshot.normalizedRoot, 'problems', 'stale.json'), '{}', 'utf8');

    await expect(runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId)).rejects.toBe(
      'not-an-error-instance',
    );
  }, 15000);

  test('rethrows an Error without an errno code as non-retryable', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const workspaceRoot = actualFs.mkdtempSync(join(tmpdir(), 'pbinfo-normalize-nocode-'));
    tempDirs.push(workspaceRoot);
    vi.resetModules();

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        rmSync(target: Parameters<typeof actual.rmSync>[0], options?: Parameters<typeof actual.rmSync>[1]) {
          if (String(target).endsWith(`${sep}problems${sep}stale.json`)) {
            throw new Error('plain error without code');
          }
          return actual.rmSync(target, options);
        },
      };
    });

    const { prepareSnapshot } = await import('../../src/archive/storage.js');
    const { loadLocalConfig } = await import('../../src/config/local-config.js');
    const { runNormalizeSnapshotWorkflow } = await import('../../src/workflows/normalize-workflow.js');
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, { snapshotId: 'normalize-nocode', scope: 'all', now: new Date() });
    actualFs.mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    actualFs.writeFileSync(join(snapshot.normalizedRoot, 'problems', 'stale.json'), '{}', 'utf8');

    await expect(runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId)).rejects.toThrow(
      'plain error without code',
    );
  }, 15000);

  test('gives up after exhausting retryable reset attempts', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const workspaceRoot = actualFs.mkdtempSync(join(tmpdir(), 'pbinfo-normalize-exhaust-'));
    tempDirs.push(workspaceRoot);
    vi.resetModules();

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        readdirSync(target: Parameters<typeof actual.readdirSync>[0], options?: Parameters<typeof actual.readdirSync>[1]) {
          if (String(target).endsWith(`${sep}normalized${sep}problems`)) {
            const error = new Error('busy') as NodeJS.ErrnoException;
            error.code = 'EBUSY';
            throw error;
          }
          return (actual.readdirSync as (...args: unknown[]) => unknown)(target, options);
        },
      };
    });

    const { prepareSnapshot } = await import('../../src/archive/storage.js');
    const { loadLocalConfig } = await import('../../src/config/local-config.js');
    const { runNormalizeSnapshotWorkflow } = await import('../../src/workflows/normalize-workflow.js');
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, { snapshotId: 'normalize-exhaust', scope: 'all', now: new Date() });
    actualFs.mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });

    await expect(runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId)).rejects.toThrow('busy');
  }, 15000);

  test('retries a retryable directory listing failure during reset', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const workspaceRoot = actualFs.mkdtempSync(join(tmpdir(), 'pbinfo-normalize-readdir-'));
    tempDirs.push(workspaceRoot);
    vi.resetModules();

    let injected = false;
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        readdirSync(target: Parameters<typeof actual.readdirSync>[0], options?: Parameters<typeof actual.readdirSync>[1]) {
          if (!injected && String(target).endsWith(`${sep}normalized${sep}problems`)) {
            injected = true;
            const error = new Error('busy') as NodeJS.ErrnoException;
            error.code = 'EBUSY';
            throw error;
          }
          return (actual.readdirSync as (...args: unknown[]) => unknown)(target, options);
        },
      };
    });

    const { prepareSnapshot } = await import('../../src/archive/storage.js');
    const { loadLocalConfig } = await import('../../src/config/local-config.js');
    const { runNormalizeSnapshotWorkflow } = await import('../../src/workflows/normalize-workflow.js');
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, { snapshotId: 'normalize-readdir', scope: 'all', now: new Date() });
    actualFs.mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });

    const result = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId);
    expect(injected).toBe(true);
    expect(result.pagesNormalized).toBe(0);
  }, 15000);
});
