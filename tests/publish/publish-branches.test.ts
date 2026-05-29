import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  exportRawArtifacts,
  prepareSnapshot,
  writeArchiveCatalog,
} from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { publishWorkspace } from '../../src/publish/publish.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setupBasicWorkspace(prefix: string, snapshotId: string, opts: {
  catalogOverrides?: Partial<{ canonicalSnapshotId: string; status: 'completed' | 'pending' }>;
  withArtifactExport?: boolean;
  artifactRootMissing?: boolean;
  packageJson?: Record<string, unknown>;
  readmeBody?: string;
} = {}) {
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

  const config = loadLocalConfig(workspaceRoot);
  const snapshot = prepareSnapshot(config, {
    snapshotId,
    scope: 'all',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });
  if (opts.withArtifactExport !== false) {
    exportRawArtifacts(config, snapshot);
  }
  const exportRootValue = opts.artifactRootMissing
    ? join(workspaceRoot, 'never-created')
    : join(config.artifacts.exportRoot, snapshot.snapshotId);
  writeArchiveCatalog(config.paths.archiveRoot, {
    currentSnapshotId: snapshot.snapshotId,
    canonicalSnapshotId: opts.catalogOverrides?.canonicalSnapshotId ?? snapshot.snapshotId,
    snapshots: [
      {
        snapshotId: snapshot.snapshotId,
        createdAt: '2026-03-10T00:00:00.000Z',
        scope: 'all',
        status: opts.catalogOverrides?.status ?? 'completed',
        checkpoint: 'canonical',
      },
    ],
    artifactExports: [
      {
        snapshotId: snapshot.snapshotId,
        exportedAt: '2026-03-10T00:00:00.000Z',
        manifestPath: snapshot.artifactManifestPath,
        exportRoot: exportRootValue,
      },
    ],
  });
  return { workspaceRoot, config, snapshot };
}

describe('publishWorkspace argument validation', () => {
  test('throws when no snapshotId is supplied', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-nosnap-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        runCommand: vi.fn(),
      }),
    ).toThrow(/requires --snapshot/);
  });

  test('rejects when the snapshot is not the canonical one', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-noncanonical-',
      'noncanonical-1',
      { catalogOverrides: { canonicalSnapshotId: 'other-snap' } },
    );
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).toThrow(/not the canonical snapshot/);
  });

  test('rejects when the snapshot status is not completed', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-notcomplete-',
      'pending-snap',
      { catalogOverrides: { status: 'pending' } },
    );
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).toThrow(/must be completed/);
  });

  test('rejects when the artifact export root is missing on disk', () => {
    // Setup with default catalog (exportRoot points at the real artifact export root)
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-missingroot-',
      'export-snap',
    );
    // Wipe the actual export directory so existsSync(exportRoot) returns false.
    rmSync(join(config.artifacts.exportRoot, snapshot.snapshotId), {
      recursive: true,
      force: true,
    });
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).toThrow(/export root is missing/);
  });
});

describe('publishWorkspace commit and remote behavior', () => {
  test('ignores a "nothing to commit" failure from git commit', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-nothingcommit-',
      'commit-clean-snap',
    );
    const calls: Array<{ command: string; args: string[] }> = [];
    publishWorkspace({
      workspaceRoot,
      config,
      snapshotId: snapshot.snapshotId,
      runCommand: (_cwd, command, args) => {
        calls.push({ command, args });
        if (command === 'git' && args[0] === 'commit') {
          const err = new Error('nothing to commit, working tree clean');
          throw err;
        }
        return '';
      },
    });
    expect(calls.some((entry) => entry.command === 'git' && entry.args[0] === 'commit')).toBe(true);
  });

  test('propagates a non-clean git commit failure', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-commitfail-',
      'commit-fail-snap',
    );
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: (_cwd, command) => {
          if (command === 'git') {
            throw new Error('unrelated git failure');
          }
          return '';
        },
      }),
    ).toThrow(/unrelated git failure/);
  });

  test('reuses an existing remote by setting its url to the canonical https remote', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-existingremote-',
      'existing-remote-snap',
    );
    const calls: Array<{ command: string; args: string[] }> = [];
    publishWorkspace({
      workspaceRoot,
      config,
      snapshotId: snapshot.snapshotId,
      runCommand: (_cwd, command, args) => {
        calls.push({ command, args });
        return '';
      },
    });
    const setUrl = calls.find(
      (call) => call.command === 'git' && call.args.join(' ').includes('remote set-url origin'),
    );
    expect(setUrl).toBeTruthy();
  });

  test('keeps an existing tag instead of recreating it when the rev-parse succeeds', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-existing-tag-',
      'existing-tag-snap',
    );
    const calls: Array<{ command: string; args: string[] }> = [];
    publishWorkspace({
      workspaceRoot,
      config,
      snapshotId: snapshot.snapshotId,
      release: true,
      runCommand: (_cwd, command, args) => {
        calls.push({ command, args });
        return '';
      },
    });
    // git tag -a should NOT have been called
    expect(
      calls.some(
        (call) => call.command === 'git' && call.args[0] === 'tag' && call.args[1] === '-a',
      ),
    ).toBe(false);
  });

  test('uploads a desktop asset against an existing release without recreating it', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-existing-release-',
      'existing-release-snap',
      { packageJson: { name: 'pbinfo-scrape', version: '0.1.0' } },
    );
    mkdirSync(join(workspaceRoot, 'release-desktop'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, 'release-desktop', 'Problem Archive Crawler 0.1.0.exe'),
      'exe',
      'utf8',
    );
    const calls: Array<{ command: string; args: string[] }> = [];
    publishWorkspace({
      workspaceRoot,
      config,
      snapshotId: snapshot.snapshotId,
      release: true,
      uploadDesktopExe: true,
      runCommand: (_cwd, command, args) => {
        calls.push({ command, args });
        return '';
      },
    });
    expect(
      calls.some(
        (call) =>
          call.command === 'gh' && call.args[0] === 'release' && call.args[1] === 'upload',
      ),
    ).toBe(true);
  });

  test('throws when release-desktop is missing', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-no-releasedir-',
      'no-release-dir-snap',
    );
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        release: true,
        uploadDesktopExe: true,
        runCommand: (_cwd, command, args) => {
          if (command === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
            throw new Error('no origin');
          }
          return '';
        },
      }),
    ).toThrow(/release-desktop is missing/);
  });

  test('throws when no branded executable exists in release-desktop', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-no-branded-',
      'no-branded-snap',
    );
    mkdirSync(join(workspaceRoot, 'release-desktop'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, 'release-desktop', 'unrelated.zip'),
      'binary',
      'utf8',
    );
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        release: true,
        uploadDesktopExe: true,
        runCommand: (_cwd, command, args) => {
          if (command === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
            throw new Error('no origin');
          }
          return '';
        },
      }),
    ).toThrow(/No final branded desktop executable/);
  });
});

describe('publishWorkspace secret detection branches', () => {
  test('flags session cookie literal strings in a README', () => {
    const cookieLine = 'PHPSESSID=abcdefghij1234567890';
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-cookie-literal-',
      'cookie-literal-snap',
      { readmeBody: `Set-Cookie: ${cookieLine}\n` },
    );
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).toThrow(/session cookie literal/);
  });

  test('flags serialized session-cookie entries in a staged JSON file', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-cookie-serialized-',
      'cookie-serialized-snap',
    );
    writeFileSync(
      join(workspaceRoot, 'src', 'fixtures.json'),
      JSON.stringify({ key: 'PHPSESSID', value: 'realsecretvalue1234567' }),
      'utf8',
    );
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).toThrow(/serialized session cookie/);
  });

  test('flags the known forbidden password literal embedded in README', () => {
    const forbidden = ['Pre', 'kzur', 'sil', '1234'].join('');
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-forbidden-',
      'forbidden-snap',
      { readmeBody: `password example: ${forbidden}\n` },
    );
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).toThrow(/plaintext credential example/);
  });
});

describe('publishWorkspace commit message preservation', () => {
  test('keeps the existing co-author trailer intact when already present', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-trailer-keep-',
      'commit-trailer-snap',
    );
    const calls: Array<{ command: string; args: string[] }> = [];
    publishWorkspace({
      workspaceRoot,
      config,
      snapshotId: snapshot.snapshotId,
      commitMessage:
        'feat: keep my trailer\n\nCo-authored-by: Codex <noreply@openai.com>',
      runCommand: (_cwd, command, args) => {
        calls.push({ command, args });
        return '';
      },
    });
    const commit = calls.find(
      (call) => call.command === 'git' && call.args[0] === 'commit',
    );
    expect(commit?.args.join(' ')).toMatch(/keep my trailer/);
    expect(
      commit?.args.filter((arg) => arg.includes('Co-authored-by: Codex')).length,
    ).toBe(1);
  });
});
