import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { exportRawArtifacts, prepareSnapshot, writeArchiveCatalog } from '../../src/archive/storage.js';
import { loadLocalConfig, type LoadedLocalConfig } from '../../src/config/local-config.js';
import { CrawlQueue } from '../../src/crawl/crawl-queue.js';
import {
  enrichCommandError,
  normalizeCommitMessage,
  publishWorkspace,
  resolveDesktopReleaseAsset,
  run,
  scanForPublishSecrets,
  shouldRetryGitIndexLock,
  sleepSync,
} from '../../src/publish/publish.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ALLOWLIST_FILES = [
  '.gitignore', 'README.md', 'SECURITY.md', 'electron-builder.json', 'package.json',
  'package-lock.json', 'tsconfig.json', 'tsconfig.desktop.json', 'vite.desktop.config.ts', 'vitest.config.ts',
];

function buildPublishable(options: { snapshotId?: string; status?: 'completed' | 'in_progress'; snapshots?: number } = {}): {
  workspaceRoot: string;
  config: LoadedLocalConfig;
  snapshotId: string;
} {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-edges-'));
  tempDirs.push(workspaceRoot);
  for (const file of ALLOWLIST_FILES) {
    writeFileSync(join(workspaceRoot, file), file.endsWith('.json') ? '{"version":"1.2.3","description":"d"}' : 'clean', 'utf8');
  }
  for (const dir of ['assets', 'scripts', 'src', 'tests']) {
    mkdirSync(join(workspaceRoot, dir), { recursive: true });
    writeFileSync(join(workspaceRoot, dir, 'f.txt'), 'clean', 'utf8');
  }
  const config = loadLocalConfig(workspaceRoot);
  const snapshotId = options.snapshotId ?? 'PUB';
  const snapshot = prepareSnapshot(config, { snapshotId, scope: 'all', now: new Date('2026-01-01T00:00:00Z') });
  exportRawArtifacts(config, snapshot);
  const snapshots = Array.from({ length: options.snapshots ?? 1 }, (_, i) => ({
    snapshotId: i === 0 ? snapshotId : `extra-${i}`,
    createdAt: '2026-01-01T00:00:00Z',
    scope: 'all' as const,
    status: (options.status ?? 'completed') as 'completed' | 'in_progress',
    checkpoint: 'canonical' as const,
  }));
  writeArchiveCatalog(config.paths.archiveRoot, {
    currentSnapshotId: snapshotId,
    canonicalSnapshotId: snapshotId,
    snapshots,
    artifactExports: [
      {
        snapshotId,
        exportedAt: '2026-01-01T00:00:00Z',
        manifestPath: snapshot.artifactManifestPath,
        exportRoot: join(config.artifacts.exportRoot, snapshotId),
      },
    ],
  });
  return { workspaceRoot, config, snapshotId };
}

type Fail = { when: (command: string, args: string[]) => boolean; error?: Error };
function fakeRun(fails: Fail[] = []): (cwd: string, command: string, args: string[]) => string {
  return (_cwd, command, args) => {
    const match = fails.find((f) => f.when(command, args));
    if (match) {
      throw match.error ?? new Error(`failed: ${command} ${args.join(' ')}`);
    }
    return '';
  };
}

describe('publishWorkspace preflight failures', () => {
  test('requires a snapshot id (defaulting runCommand to the real runner)', () => {
    const { config } = buildPublishable();
    expect(() => publishWorkspace({ workspaceRoot: '.', config })).toThrow(/requires --snapshot/);
  });

  test('rejects an unknown snapshot id', () => {
    const { workspaceRoot, config } = buildPublishable();
    expect(() => publishWorkspace({ workspaceRoot, config, snapshotId: 'other', runCommand: fakeRun() })).toThrow();
  });

  test('rejects a present-but-non-canonical snapshot', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable();
    writeArchiveCatalog(config.paths.archiveRoot, {
      currentSnapshotId: snapshotId,
      canonicalSnapshotId: 'different-canonical',
      snapshots: [
        { snapshotId, createdAt: '2026-01-01T00:00:00Z', scope: 'all', status: 'completed', checkpoint: 'canonical' },
      ],
      artifactExports: [],
    });
    expect(() => publishWorkspace({ workspaceRoot, config, snapshotId, runCommand: fakeRun() })).toThrow(/not the canonical/);
  });

  test('rejects a missing raw artifact export root', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable();
    rmSync(join(config.artifacts.exportRoot, snapshotId), { recursive: true, force: true });
    expect(() => publishWorkspace({ workspaceRoot, config, snapshotId, runCommand: fakeRun() })).toThrow(/export root is missing/);
  });

  test('rejects when more than one snapshot remains', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable({ snapshots: 2 });
    expect(() => publishWorkspace({ workspaceRoot, config, snapshotId, runCommand: fakeRun() })).toThrow(/exactly one snapshot/);
  });

  test('rejects an undrained queue', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable();
    const queue = new CrawlQueue(join(config.paths.localRoot, 'crawl-queues', `${snapshotId}.sqlite`));
    queue.enqueueMany([{ key: 'k', url: 'https://x/', kind: 'public-page' }]);
    queue.close();
    expect(() => publishWorkspace({ workspaceRoot, config, snapshotId, runCommand: fakeRun() })).toThrow(/not fully drained/);
  });

  test('rejects an incomplete snapshot', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable({ status: 'in_progress' });
    expect(() => publishWorkspace({ workspaceRoot, config, snapshotId, runCommand: fakeRun() })).toThrow(/must be completed/);
  });

  test('rejects when secret-like material is staged', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable();
    writeFileSync(join(workspaceRoot, 'README.md'), 'password: hunter2supersecret', 'utf8');
    expect(() => publishWorkspace({ workspaceRoot, config, snapshotId, runCommand: fakeRun() })).toThrow(/secret-like/);
  });
});

describe('publishWorkspace command flow', () => {
  test('initializes git, creates the repo, adds the remote, and tolerates an empty commit', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable();
    const result = publishWorkspace({
      workspaceRoot,
      config,
      snapshotId,
      runCommand: fakeRun([
        { when: (c, a) => c === 'git' && a[0] === 'commit', error: new Error('nothing to commit, working tree clean') },
        { when: (c, a) => c === 'gh' && a[0] === 'repo' && a[1] === 'view' },
        { when: (c, a) => c === 'git' && a[0] === 'remote' && a[1] === 'get-url' },
      ]),
    });
    expect(result.initializedGit).toBe(true);
    expect(result.snapshotId).toBe(snapshotId);
  });

  test('proceeds past a drained queue and tolerates a non-Error empty-commit signal', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable();
    const queue = new CrawlQueue(join(config.paths.localRoot, 'crawl-queues', `${snapshotId}.sqlite`));
    queue.close();
    const result = publishWorkspace({
      workspaceRoot,
      config,
      snapshotId,
      runCommand: ((cwd: string, command: string, args: string[]): string => {
        if (command === 'git' && args[0] === 'commit') {
          throw 'nothing to commit, working tree clean';
        }
        return '';
      }) as (cwd: string, command: string, args: string[]) => string,
    });
    expect(result.snapshotId).toBe(snapshotId);
  });

  test('ignores a failed git reset on an unborn repository', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable();
    const result = publishWorkspace({
      workspaceRoot,
      config,
      snapshotId,
      runCommand: fakeRun([
        { when: (c, a) => c === 'git' && a[0] === 'reset', error: new Error('unborn') },
        { when: (c, a) => c === 'gh' && a[0] === 'repo' && a[1] === 'view' },
        { when: (c, a) => c === 'git' && a[0] === 'remote' && a[1] === 'get-url' },
      ]),
    });
    expect(result.snapshotId).toBe(snapshotId);
  });

  test('rethrows a non-empty commit failure', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable();
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId,
        runCommand: fakeRun([{ when: (c, a) => c === 'git' && a[0] === 'commit', error: new Error('merge conflict') }]),
      }),
    ).toThrow(/merge conflict/);
  });

  test('publishes a release and uploads the desktop executable', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable();
    const releaseRoot = join(workspaceRoot, 'release-desktop');
    mkdirSync(releaseRoot, { recursive: true });
    writeFileSync(join(releaseRoot, 'Problem Archive Crawler 1.0.0.exe'), 'a', 'utf8');
    writeFileSync(join(releaseRoot, 'Problem Archive Crawler 1.2.3.exe'), 'b', 'utf8');
    utimesSync(join(releaseRoot, 'Problem Archive Crawler 1.0.0.exe'), new Date(1000), new Date(1000));
    utimesSync(join(releaseRoot, 'Problem Archive Crawler 1.2.3.exe'), new Date(2000), new Date(2000));

    const result = publishWorkspace({
      workspaceRoot,
      config,
      snapshotId,
      release: true,
      uploadDesktopExe: true,
      runCommand: fakeRun(),
    });
    expect(result.tag).toBe('v1.2.3');
    expect(result.releaseAssetPath).toContain('1.2.3.exe');
  });

  test('creates the repo, remote, tag, and release when lookups fail', () => {
    const { workspaceRoot, config, snapshotId } = buildPublishable();
    const result = publishWorkspace({
      workspaceRoot,
      config,
      snapshotId,
      release: true,
      tag: 'v9.9.9',
      runCommand: fakeRun([
        { when: (c, a) => c === 'gh' && a[0] === 'repo' && a[1] === 'view', error: new Error('not found') },
        { when: (c, a) => c === 'git' && a[0] === 'remote' && a[1] === 'add' === false && a[1] === 'get-url', error: new Error('no remote') },
        { when: (c, a) => c === 'git' && a[0] === 'rev-parse', error: new Error('no tag') },
        { when: (c, a) => c === 'gh' && a[0] === 'release' && a[1] === 'view', error: new Error('no release') },
      ]),
    });
    expect(result.tag).toBe('v9.9.9');
  });
});

describe('resolveDesktopReleaseAsset', () => {
  test('throws when release-desktop is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-rel-'));
    tempDirs.push(root);
    expect(() => resolveDesktopReleaseAsset(root)).toThrow(/release-desktop is missing/);
  });

  test('rejects leftover legacy executables', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-rel-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'release-desktop'), { recursive: true });
    writeFileSync(join(root, 'release-desktop', 'PBInfo Archive Desktop 1.0.0.exe'), 'x', 'utf8');
    expect(() => resolveDesktopReleaseAsset(root)).toThrow(/Legacy desktop executable/);
  });

  test('throws when no branded executable exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-rel-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'release-desktop'), { recursive: true });
    writeFileSync(join(root, 'release-desktop', 'random.exe'), 'x', 'utf8');
    expect(() => resolveDesktopReleaseAsset(root)).toThrow(/No final branded desktop executable/);
  });
});

describe('publish helpers', () => {
  test('run succeeds, rethrows non-retryable failures, and retries on a stale git index lock', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pbinfo-run-'));
    tempDirs.push(cwd);
    expect(() => run(cwd, process.execPath, ['--version'])).not.toThrow();
    expect(() => run(cwd, process.execPath, ['-e', 'process.exit(1)'])).toThrow();

    run(cwd, 'git', ['init']);
    expect(() => run(cwd, 'git', ['frobnicate-not-a-real-subcommand'])).toThrow();
    writeFileSync(join(cwd, 'tracked.txt'), 'data', 'utf8');
    writeFileSync(join(cwd, '.git', 'index.lock'), '', 'utf8');
    expect(() => run(cwd, 'git', ['add', 'tracked.txt'])).toThrow(/index\.lock/i);
  }, 30000);

  test('enrichCommandError formats non-Error values and appends stream output', () => {
    expect(enrichCommandError('boom', 'git', ['status']).message).toContain('Command failed: git status');
    const stringStreams = Object.assign(new Error('base'), { stdout: 'outstr', stderr: 'errstr' });
    expect(enrichCommandError(stringStreams, 'git', []).message).toContain('errstr');
    const bufferStdout = Object.assign(new Error('base2'), { stdout: Buffer.from('bufout') });
    expect(enrichCommandError(bufferStdout, 'git', []).message).toContain('bufout');
    const bufferStderr = Object.assign(new Error('base3'), { stderr: Buffer.from('buferr') });
    expect(enrichCommandError(bufferStderr, 'git', []).message).toContain('buferr');
    const plain = new Error('plain');
    expect(enrichCommandError(plain, 'git', [])).toBe(plain);
  });

  test('shouldRetryGitIndexLock detects index lock messages', () => {
    expect(shouldRetryGitIndexLock(new Error('Unable to create .git/index.lock'))).toBe(true);
    expect(shouldRetryGitIndexLock('plain index.lock string')).toBe(true);
    expect(shouldRetryGitIndexLock(new Error('other'))).toBe(false);
  });

  test('sleepSync returns without throwing', () => {
    expect(() => sleepSync(1)).not.toThrow();
  });

  test('scanForPublishSecrets flags multiple secret shapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-scan-'));
    tempDirs.push(root);
    mkdirSync(join(root, '.local'), { recursive: true });
    writeFileSync(join(root, '.local', 'x.txt'), 'anything', 'utf8');
    writeFileSync(
      join(root, 'README.md'),
      'password: realsecretvalue\nPHPSESSID=abcdef123456\n{"key":"PHPSESSID","value":"dumpedcookie123"}',
      'utf8',
    );
    mkdirSync(join(root, 'src', 'publish'), { recursive: true });
    writeFileSync(join(root, 'src', 'safe.json'), '{"password":"YOUR_PASSWORD"}', 'utf8');
    writeFileSync(join(root, 'src', 'publish', 'publish.ts'), 'password: "realleak"', 'utf8');
    const violations = scanForPublishSecrets(root, ['.local/x.txt', 'README.md', 'src', 'missing']);
    expect(violations.some((v) => v.includes('local-only'))).toBe(true);
    expect(violations.some((v) => v.includes('password material'))).toBe(true);
    expect(violations.some((v) => v.includes('session cookie literal'))).toBe(true);
    expect(violations.some((v) => v.includes('serialized session cookie'))).toBe(true);
  });

  test('scanForPublishSecrets flags the known forbidden password and skips unreadable directory entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-scan2-'));
    tempDirs.push(root);
    mkdirSync(join(root, '.local', 'nested'), { recursive: true });
    writeFileSync(join(root, 'creds.txt'), `leaked=${['Pre', 'kzur', 'sil', '1234'].join('')}`, 'utf8');
    const violations = scanForPublishSecrets(root, ['creds.txt', '.local']);
    expect(violations.some((v) => v.includes('plaintext credential example'))).toBe(true);
  });

  test('normalizeCommitMessage appends the trailer once', () => {
    const once = normalizeCommitMessage('feat: x');
    expect(once).toContain('Co-authored-by');
    expect(normalizeCommitMessage(once)).toBe(once);
  });
});
