import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const workspaceRoot = process.cwd();
const desktopOutputRoot = join(workspaceRoot, 'dist-desktop');
const releaseDesktopRoot = join(workspaceRoot, 'release-desktop');
const winUnpackedRoot = join(releaseDesktopRoot, 'win-unpacked');

safeRm(desktopOutputRoot);
safeRm(winUnpackedRoot);

if (existsSync(releaseDesktopRoot)) {
  for (const entry of readdirSync(releaseDesktopRoot, {
    withFileTypes: true,
  })) {
    if (
      entry.isFile()
      && (entry.name.endsWith('.nsis.7z') || entry.name.toLowerCase().endsWith('.exe'))
    ) {
      rmSync(join(releaseDesktopRoot, entry.name), {
        force: true,
        maxRetries: 10,
        retryDelay: 250,
      });
    }
  }
}

function safeRm(path) {
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250,
  });
}
