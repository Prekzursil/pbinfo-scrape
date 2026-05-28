import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  exportRawArtifacts,
  prepareSnapshot,
  relinkRawArtifacts,
  writeArchiveCatalog,
} from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { CrawlQueue } from '../../src/crawl/crawl-queue.js';
import { publishWorkspace } from '../../src/publish/publish.js';

const tempDirs: string[] = [];

const MISSING_RESOURCE_PROBES: ReadonlyArray<{
  command: string;
  prefix: readonly string[];
  error: string;
}> = [
  { command: 'gh', prefix: ['repo', 'view'], error: 'repo missing' },
  { command: 'git', prefix: ['remote', 'get-url'], error: 'no origin' },
  { command: 'git', prefix: ['rev-parse', '--verify'], error: 'missing tag' },
  { command: 'gh', prefix: ['release', 'view'], error: 'missing release' },
];

function throwForMissingResourceProbe(command: string, args: string[]): void {
  for (const probe of MISSING_RESOURCE_PROBES) {
    const matches =
      command === probe.command && probe.prefix.every((value, index) => args[index] === value);
    if (matches) {
      throw new Error(probe.error);
    }
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('publishWorkspace', () => {
  test('stages desktop packaging files alongside archive sources on successful publish preflight', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-stage-'));
    tempDirs.push(workspaceRoot);

    writeFileSync(join(workspaceRoot, 'README.md'), '# PBInfo\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'SECURITY.md'), '# Security\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'package.json'), '{"name":"pbinfo-scrape"}\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'package-lock.json'), '{}\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'tsconfig.json'), '{}\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'tsconfig.desktop.json'), '{}\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'vitest.config.ts'), 'export default {};\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'vite.desktop.config.ts'), 'export default {};\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'electron-builder.json'), '{}\n', 'utf8');
    mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
    mkdirSync(join(workspaceRoot, 'tests'), { recursive: true });
    mkdirSync(join(workspaceRoot, 'scripts'), { recursive: true });
    mkdirSync(join(workspaceRoot, 'assets'), { recursive: true });
    writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export {};\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'tests', 'index.test.ts'), 'export {};\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'scripts', 'run.mjs'), 'console.log("ok");\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'assets', 'logo.svg'), '<svg />\n', 'utf8');

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'publish-stage-happy',
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

    const commands: Array<{ command: string; args: string[] }> = [];
    const result = publishWorkspace({
      workspaceRoot,
      config,
      snapshotId: snapshot.snapshotId,
      runCommand: (cwd, command, args) => {
        expect(cwd).toBe(workspaceRoot);
        commands.push({ command, args });
        return '';
      },
    });

    expect(result.stagedPaths).toEqual(
      expect.arrayContaining([
        'src',
        'tests',
        'archive',
        'scripts',
        'assets',
        'SECURITY.md',
        'electron-builder.json',
        'tsconfig.desktop.json',
        'vite.desktop.config.ts',
      ]),
    );
    expect(
      commands.some(
        (entry) =>
          entry.command === 'git' && entry.args[0] === 'add' && entry.args[1] === '--intent-to-add',
      ),
    ).toBe(false);

    const gitAdd = commands.find(
      (entry) => entry.command === 'git' && entry.args[0] === 'add' && entry.args[1] === '--',
    );
    expect(gitAdd?.args).toEqual(
      expect.arrayContaining([
        '--',
        'scripts',
        'assets',
        'SECURITY.md',
        'electron-builder.json',
        'tsconfig.desktop.json',
        'vite.desktop.config.ts',
      ]),
    );
  });

  test('creates the GitHub repo before wiring origin when the remote repository does not exist yet', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-create-'));
    tempDirs.push(workspaceRoot);

    writeFileSync(join(workspaceRoot, 'README.md'), '# PBInfo\n', 'utf8');
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      '{"name":"pbinfo-scrape","version":"0.1.0","description":"Problem Archive Crawler - PBInfo archival operator console."}\n',
      'utf8',
    );
    mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
    mkdirSync(join(workspaceRoot, 'archive'), { recursive: true });
    writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export {};\n', 'utf8');

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'publish-create-snapshot',
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

    const commands: Array<{ command: string; args: string[] }> = [];
    publishWorkspace({
      workspaceRoot,
      config,
      snapshotId: snapshot.snapshotId,
      runCommand: (cwd, command, args) => {
        expect(cwd).toBe(workspaceRoot);
        commands.push({ command, args });
        if (command === 'gh' && args[0] === 'repo' && args[1] === 'view') {
          throw new Error('not found');
        }
        if (command === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
          throw new Error('no origin');
        }
        return '';
      },
    });

    const ghCreateIndex = commands.findIndex(
      (entry) =>
        entry.command === 'gh' &&
        entry.args
          .join(' ')
          .includes('repo create Prekzursil/pbinfo-scrape --private --description'),
    );
    const gitAddOriginIndex = commands.findIndex(
      (entry) =>
        entry.command === 'git' &&
        entry.args.join(' ') ===
          'remote add origin https://github.com/Prekzursil/pbinfo-scrape.git',
    );

    expect(ghCreateIndex).toBeGreaterThanOrEqual(0);
    expect(gitAddOriginIndex).toBeGreaterThan(ghCreateIndex);
  });

  test('rejects publication when tracked files contain obvious secret material', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-secret-'));
    tempDirs.push(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, 'README.md'),
      'username: Prekzursil\npassword: super-secret-live-password\n',
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'publish-secret-snapshot',
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

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).toThrow(/secret/i);
  });

  test('allows placeholder password examples in repo-safe documentation', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-placeholder-'));
    tempDirs.push(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'pbinfo-scrape', version: '0.1.0' }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, 'README.md'),
      JSON.stringify(
        {
          auth: {
            username: 'YOUR_PBINFO_USERNAME',
            password: 'YOUR_PBINFO_PASSWORD',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'publish-placeholder-snapshot',
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

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).not.toThrow();
  });

  test('rejects publication when raw artifacts were not exported for the selected snapshot', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-artifacts-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'publish-missing-artifacts',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
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
      artifactExports: [],
    });

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).toThrow(/Raw artifact export/i);
  });

  test('accepts publication preflight when raw artifacts are relinked from an external manifest', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-relinked-artifacts-'));
    tempDirs.push(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'pbinfo-scrape', version: '0.1.0' }, null, 2),
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'publish-relinked-snapshot',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    const exported = exportRawArtifacts(
      config,
      snapshot,
      join(workspaceRoot, 'external-artifacts'),
      new Date('2026-03-10T01:00:00.000Z'),
    );

    relinkRawArtifacts(
      config,
      snapshot.snapshotId,
      join(workspaceRoot, 'external-artifacts', snapshot.snapshotId, 'manifest.json'),
    );

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
      artifactExports: [],
    });

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).not.toThrow();
    expect(existsSync(exported.rawPagesPath)).toBe(true);
  });

  test('rejects publication when more than one snapshot remains', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-multiple-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const first = prepareSnapshot(config, {
      snapshotId: 'publish-first',
      scope: 'all',
      now: new Date('2026-03-09T00:00:00.000Z'),
    });
    const second = prepareSnapshot(config, {
      snapshotId: 'publish-second',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    exportRawArtifacts(config, second);
    writeArchiveCatalog(config.paths.archiveRoot, {
      currentSnapshotId: second.snapshotId,
      canonicalSnapshotId: second.snapshotId,
      snapshots: [
        {
          snapshotId: first.snapshotId,
          createdAt: '2026-03-09T00:00:00.000Z',
          scope: 'all',
          status: 'completed',
          checkpoint: 'checkpoint',
        },
        {
          snapshotId: second.snapshotId,
          createdAt: '2026-03-10T00:00:00.000Z',
          scope: 'all',
          status: 'completed',
          checkpoint: 'canonical',
        },
      ],
      artifactExports: [
        {
          snapshotId: second.snapshotId,
          exportedAt: '2026-03-10T00:00:00.000Z',
          manifestPath: second.artifactManifestPath,
          exportRoot: join(config.artifacts.exportRoot, second.snapshotId),
        },
      ],
    });

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: second.snapshotId,
        runCommand: vi.fn(),
      }),
    ).toThrow(/exactly one snapshot/i);
  });

  test('rejects publication when the selected snapshot is not drained', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-pending-'));
    tempDirs.push(workspaceRoot);
    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'publish-pending',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    mkdirSync(join(config.paths.localRoot, 'crawl-queues'), { recursive: true });
    const queue = new CrawlQueue(
      join(config.paths.localRoot, 'crawl-queues', 'publish-pending.sqlite'),
    );
    queue.enqueueMany([
      {
        key: 'page:https://www.pbinfo.ro/',
        url: 'https://www.pbinfo.ro/',
        kind: 'public-page',
      },
    ]);
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

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        runCommand: vi.fn(),
      }),
    ).toThrow(/not fully drained/i);
  });

  test('creates repo metadata, annotated tag, and GitHub release asset when release publishing is requested', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-release-'));
    tempDirs.push(workspaceRoot);

    writeFileSync(join(workspaceRoot, 'README.md'), '# Problem Archive Crawler\n', 'utf8');
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'pbinfo-scrape',
          version: '0.1.0',
          description: 'Problem Archive Crawler - PBInfo archival operator console.',
        },
        null,
        2,
      ),
      'utf8',
    );
    mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
    writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export {};\n', 'utf8');
    mkdirSync(join(workspaceRoot, 'release-desktop'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, 'release-desktop', 'Problem Archive Crawler 0.1.0.exe'),
      'portable exe',
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'publish-release-snapshot',
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

    const commands: Array<{ command: string; args: string[] }> = [];
    const result = publishWorkspace({
      workspaceRoot,
      config,
      snapshotId: snapshot.snapshotId,
      release: true,
      uploadDesktopExe: true,
      runCommand: (cwd, command, args) => {
        expect(cwd).toBe(workspaceRoot);
        commands.push({ command, args });
        throwForMissingResourceProbe(command, args);
        return '';
      },
    });

    expect(result.tag).toBe('v0.1.0');
    expect(result.releaseAssetPath).toContain('Problem Archive Crawler 0.1.0.exe');

    expect(
      commands.some(
        (entry) =>
          entry.command === 'gh' &&
          entry.args
            .join(' ')
            .includes(
              'repo edit Prekzursil/pbinfo-scrape --description Problem Archive Crawler - PBInfo archival operator console. --default-branch main',
            ),
      ),
    ).toBe(true);
    expect(
      commands.some(
        (entry) =>
          entry.command === 'git' &&
          entry.args.join(' ') === 'tag -a v0.1.0 -m Problem Archive Crawler 0.1.0',
      ),
    ).toBe(true);
    expect(
      commands.some(
        (entry) =>
          entry.command === 'git' && entry.args.join(' ') === 'push origin refs/tags/v0.1.0',
      ),
    ).toBe(true);
    expect(
      commands.some(
        (entry) =>
          entry.command === 'gh' &&
          entry.args[0] === 'release' &&
          entry.args[1] === 'create' &&
          entry.args.includes('v0.1.0') &&
          entry.args.some((value) => value.includes('Problem Archive Crawler 0.1.0.exe#')),
      ),
    ).toBe(true);
  });

  test('rejects release upload when only a legacy PBInfo-branded desktop executable exists', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-publish-legacy-exe-'));
    tempDirs.push(workspaceRoot);

    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'pbinfo-scrape', version: '0.1.0' }, null, 2),
      'utf8',
    );
    writeFileSync(join(workspaceRoot, 'README.md'), '# Problem Archive Crawler\n', 'utf8');
    mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
    writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export {};\n', 'utf8');
    mkdirSync(join(workspaceRoot, 'release-desktop'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, 'release-desktop', 'PBInfo Archive Desktop 0.1.0.exe'),
      'legacy exe',
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'publish-legacy-exe-snapshot',
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

    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        release: true,
        uploadDesktopExe: true,
        runCommand: (cwd, command, args) => {
          expect(cwd).toBe(workspaceRoot);
          if (command === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
            throw new Error('no origin');
          }
          if (command === 'gh' && args[0] === 'release' && args[1] === 'view') {
            throw new Error('no release');
          }
          return '';
        },
      }),
    ).toThrow(/Legacy desktop executable/i);
  });
});
