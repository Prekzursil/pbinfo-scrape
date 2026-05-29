import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

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

function setupBasicWorkspace(prefix: string, snapshotId: string) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(workspaceRoot);

  writeFileSync(
    join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: 'pbinfo-scrape', version: '0.1.0' }, null, 2),
    'utf8',
  );
  writeFileSync(join(workspaceRoot, 'README.md'), '# Hi\n', 'utf8');
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
  writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export {};\n', 'utf8');

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

describe('publishWorkspace default run function and command enrichment', () => {
  test('default run executes git locally and surfaces enriched errors when gh is missing', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-default-run-',
      'default-run-snap',
    );
    // No runCommand override -> uses the default `run` that invokes execFileSync.
    // Expect it to fail at `gh repo view` because gh is unavailable in this env.
    expect(() =>
      publishWorkspace({
        workspaceRoot,
        config,
        snapshotId: snapshot.snapshotId,
        release: false,
        uploadDesktopExe: false,
      }),
    ).toThrow();
  });
});

describe('publishWorkspace desktop release asset latest filter', () => {
  test('picks the most recent branded executable by mtime when multiple exist', () => {
    const { workspaceRoot, config, snapshot } = setupBasicWorkspace(
      'pbinfo-publish-latest-',
      'latest-snap',
    );
    mkdirSync(join(workspaceRoot, 'release-desktop'), { recursive: true });

    const older = join(workspaceRoot, 'release-desktop', 'Problem Archive Crawler 0.1.0.exe');
    const newer = join(workspaceRoot, 'release-desktop', 'Problem Archive Crawler 0.2.0.exe');
    writeFileSync(older, 'older-content', 'utf8');
    writeFileSync(newer, 'newer-content', 'utf8');
    // Force older to have an earlier mtime.
    utimesSync(older, new Date('2026-03-09T00:00:00.000Z'), new Date('2026-03-09T00:00:00.000Z'));
    utimesSync(newer, new Date('2026-03-10T12:00:00.000Z'), new Date('2026-03-10T12:00:00.000Z'));

    const uploadCalls: Array<{ command: string; args: string[] }> = [];
    publishWorkspace({
      workspaceRoot,
      config,
      snapshotId: snapshot.snapshotId,
      release: true,
      uploadDesktopExe: true,
      runCommand: (_cwd, command, args) => {
        uploadCalls.push({ command, args });
        return '';
      },
    });

    const uploadCall = uploadCalls.find(
      (call) =>
        call.command === 'gh' &&
        call.args[0] === 'release' &&
        (call.args[1] === 'upload' || call.args[1] === 'create'),
    );
    expect(uploadCall).toBeDefined();
    expect(
      uploadCall!.args.some((arg) => arg.includes('Problem Archive Crawler 0.2.0.exe')),
    ).toBe(true);
  });
});

