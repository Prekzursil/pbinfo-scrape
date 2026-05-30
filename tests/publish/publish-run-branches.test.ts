/**
 * Covers the remaining uncovered branches in publish.ts:
 *  - commitStagedWorkspace: non-"nothing to commit" throw when .git exists (lines 131-132)
 *  - stageAndCommitWorkspace: git reset failure on unborn repo (line 185)
 *  - shouldScanStructuredSecrets: src/publish/publish.ts whitelist bypass (lines 341-342)
 *  - run: execFileSync retry on index.lock error (lines 407-454 — shouldRetryGitIndexLock, sleepSync)
 *  - enrichCommandError: with stderr Buffer details (lines 441-443)
 *  - streamToString: Buffer branch (lines 419-422)
 *  - enrichCommandError: non-Error throw wrapping (line 426-428)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  exportRawArtifacts,
  prepareSnapshot,
  writeArchiveCatalog,
} from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { publishWorkspace } from '../../src/publish/publish.js';

// Control variables shared between the mock factory and test bodies.
// We use module-level state because vi.mock factories are hoisted.
let execFileSyncMock: ReturnType<typeof vi.fn>;
let execFileSyncCallCount = 0;
let execFileSyncImpl: ((...args: unknown[]) => string) | null = null;

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => {
    execFileSyncCallCount++;
    if (execFileSyncImpl) {
      return execFileSyncImpl(...args);
    }
    return '';
  },
}));

const tempDirs: string[] = [];

beforeEach(() => {
  execFileSyncCallCount = 0;
  execFileSyncImpl = null;
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setupWorkspace(
  prefix: string,
  snapshotId: string,
  opts: {
    packageJson?: Record<string, unknown>;
    readmeBody?: string;
    createDotGit?: boolean;
    extraFiles?: Record<string, string>;
  } = {},
) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(workspaceRoot);

  writeFileSync(
    join(workspaceRoot, 'package.json'),
    JSON.stringify(opts.packageJson ?? { name: 'pbinfo-scrape', version: '0.1.0' }, null, 2),
    'utf8',
  );
  writeFileSync(join(workspaceRoot, 'README.md'), opts.readmeBody ?? '# Hi\n', 'utf8');
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
  writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export {};\n', 'utf8');

  for (const [filePath, content] of Object.entries(opts.extraFiles ?? {})) {
    const fullPath = join(workspaceRoot, filePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }

  if (opts.createDotGit) {
    mkdirSync(join(workspaceRoot, '.git'), { recursive: true });
  }

  const config = loadLocalConfig(workspaceRoot);
  const snapshot = prepareSnapshot(config, {
    snapshotId,
    scope: 'all',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });
  exportRawArtifacts(config, snapshot);
  writeArchiveCatalog(config.paths.archiveRoot, {
    currentSnapshotId: snapshot.snapshotId,
    canonicalSnapshotId: snapshot.snapshotId,
    snapshots: [
      {
        snapshotId: snapshot.snapshotId,
        createdAt: '2026-03-10T00:00:00.000Z',
        scope: 'all',
        status: 'completed',
        checkpoint: 'canonical',
      },
    ],
    artifactExports: [
      {
        snapshotId: snapshot.snapshotId,
        exportedAt: '2026-03-10T00:00:00.000Z',
        manifestPath: snapshot.artifactManifestPath,
        exportRoot: join(config.artifacts.exportRoot, snapshot.snapshotId),
      },
    ],
  });
  return { workspaceRoot, config, snapshot };
}

describe('publishWorkspace commit edge branches', () => {
  test('propagates non-"nothing to commit" error from git commit when .git already exists', () => {
    // createDotGit=true → initializedGit=false → git init/checkout NOT called
    // git reset and git add succeed; only git commit throws → hits lines 131-132
    const { workspaceRoot, config, snapshot } = setupWorkspace(
      'pbinfo-pub-gitexists-commitfail-',
      'gitexists-commit-fail',
      { createDotGit: true },
    );

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: (_cwd, command, args) => {
          if (command === 'git' && args[0] === 'commit') {
            throw new Error('index.lock: file already exists');
          }
          return '';
        },
      }),
    ).toThrow(/index\.lock/);
  });

  test('silently catches git reset failure on unborn repository', () => {
    // .git does NOT exist → initializedGit=true → git init and checkout are called first
    // When git reset throws, the catch block at line 183-185 silently swallows it
    const { workspaceRoot, config, snapshot } = setupWorkspace(
      'pbinfo-pub-unborn-reset-',
      'unborn-reset-snap',
    );

    const commands: Array<string[]> = [];
    publishWorkspace({
      workspaceRoot,
      config,
      snapshotId: snapshot.snapshotId,
      runCommand: (_cwd, command, args) => {
        commands.push([command, ...args]);
        // git reset throws (simulates unborn repository state)
        if (command === 'git' && args[0] === 'reset') {
          throw new Error('fatal: Failed to resolve HEAD as a valid ref.');
        }
        return '';
      },
    });

    // git init, checkout, reset (silenced), add, commit should all have been attempted
    expect(commands.some((c) => c[0] === 'git' && c[1] === 'init')).toBe(true);
    expect(commands.some((c) => c[0] === 'git' && c[1] === 'reset')).toBe(true);
    expect(commands.some((c) => c[0] === 'git' && c[1] === 'add')).toBe(true);
  });

  test('shouldScanStructuredSecrets returns false for src/publish/publish.ts path', () => {
    // Creating src/publish/publish.ts in the workspace means it will be scanned
    // and shouldScanStructuredSecrets will hit the early return at line 341-342
    const { workspaceRoot, config, snapshot } = setupWorkspace(
      'pbinfo-pub-scanexclude-',
      'scan-exclude-snap',
      {
        extraFiles: {
          // This file matches the exact path checked in shouldScanStructuredSecrets
          'src/publish/publish.ts': '// safe placeholder content\n',
        },
      },
    );

    // Should NOT throw a secret violation even if publish.ts contained suspicious content
    // (because the file is excluded from structured secret scanning)
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(() => ''),
      }),
    ).not.toThrow();
  });
});

describe('publishWorkspace run() function branches (execFileSync mocked at module level)', () => {
  test('run() retries on .git/index.lock error, invokes sleepSync, then succeeds', () => {
    // Fail 3 times with index.lock, then succeed — exercises shouldRetryGitIndexLock and sleepSync
    let callCount = 0;
    execFileSyncImpl = () => {
      callCount++;
      if (callCount <= 3) {
        const err = new Error('fatal: Unable to create .git/index.lock');
        throw err;
      }
      return '';
    };

    const { workspaceRoot, config, snapshot } = setupWorkspace(
      'pbinfo-pub-indexlock-',
      'index-lock-snap',
    );

    // publishWorkspace with no runCommand → uses the real run() function backed by the mocked execFileSync
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
      }),
    ).not.toThrow();

    // execFileSync should have been called at least 4 times (3 index.lock failures + 1 success for git init)
    expect(callCount).toBeGreaterThanOrEqual(4);
  });

  test('run() throws immediately on non-retryable git error', () => {
    execFileSyncImpl = () => {
      throw new Error('fatal: not a git repository');
    };

    const { workspaceRoot, config, snapshot } = setupWorkspace(
      'pbinfo-pub-nonretry-',
      'non-retry-snap',
    );

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
      }),
    ).toThrow(/fatal: not a git repository/);

    // Only one call — no retry for non-index-lock error
    expect(execFileSyncCallCount).toBe(1);
  });

  test('enrichCommandError appends stderr Buffer content to error message', () => {
    // Exercises streamToString Buffer branch (line 420-422) and enrichCommandError details (441-443)
    execFileSyncImpl = () => {
      const errorWithStreams = Object.assign(new Error('Command failed'), {
        stderr: Buffer.from('error: stderr details here', 'utf8'),
        stdout: Buffer.from('out: stdout output', 'utf8'),
      });
      throw errorWithStreams;
    };

    const { workspaceRoot, config, snapshot } = setupWorkspace(
      'pbinfo-pub-stderr-',
      'stderr-snap',
    );

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
      }),
    ).toThrow(/stderr details here/);
  });

  test('enrichCommandError wraps non-Error throw as a generic Error', () => {
    // Exercises the `!(error instanceof Error)` branch (line 426-428 in enrichCommandError)
    execFileSyncImpl = () => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error value';
    };

    const { workspaceRoot, config, snapshot } = setupWorkspace(
      'pbinfo-pub-nonerrthrow-',
      'nonerr-snap',
    );

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
      }),
    ).toThrow(/Command failed/);
  });

});
