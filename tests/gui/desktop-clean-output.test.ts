import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const cleanScript = join(repoRoot, 'scripts', 'clean-desktop-output.mjs');
const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

describe('desktop clean script', () => {
  test('removes stale packaging intermediates that can block electron-builder', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-clean-desktop-'));
    cleanupPaths.push(workspaceRoot);

    const distDesktopRoot = join(workspaceRoot, 'dist-desktop');
    const releaseDesktopRoot = join(workspaceRoot, 'release-desktop');
    const winUnpackedRoot = join(releaseDesktopRoot, 'win-unpacked');
    const nsisArchivePath = join(releaseDesktopRoot, 'pbinfo-scrape-0.1.0-x64.nsis.7z');
    const finalExePath = join(releaseDesktopRoot, 'Problem Archive Crawler 0.1.0.exe');
    const legacyExePath = join(releaseDesktopRoot, 'PBInfo Archive Desktop 0.1.0.exe');

    mkdirSync(distDesktopRoot, { recursive: true });
    mkdirSync(winUnpackedRoot, { recursive: true });
    writeFileSync(join(distDesktopRoot, 'marker.txt'), 'dist', 'utf8');
    writeFileSync(join(winUnpackedRoot, 'marker.txt'), 'unpacked', 'utf8');
    writeFileSync(nsisArchivePath, 'archive', 'utf8');
    writeFileSync(finalExePath, 'final-exe', 'utf8');
    writeFileSync(legacyExePath, 'legacy-exe', 'utf8');

    const result = spawnSync(process.execPath, [cleanScript], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(existsSync(distDesktopRoot)).toBe(false);
    expect(existsSync(winUnpackedRoot)).toBe(false);
    expect(existsSync(nsisArchivePath)).toBe(false);
    expect(existsSync(finalExePath)).toBe(false);
    expect(existsSync(legacyExePath)).toBe(false);
  });

  test('succeeds even when release-desktop has not been created yet', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-clean-desktop-empty-'));
    cleanupPaths.push(workspaceRoot);

    const distDesktopRoot = join(workspaceRoot, 'dist-desktop');
    mkdirSync(distDesktopRoot, { recursive: true });
    writeFileSync(join(distDesktopRoot, 'marker.txt'), 'dist', 'utf8');

    const result = spawnSync(process.execPath, [cleanScript], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(existsSync(distDesktopRoot)).toBe(false);
    expect(existsSync(join(workspaceRoot, 'release-desktop'))).toBe(false);
  });
});
