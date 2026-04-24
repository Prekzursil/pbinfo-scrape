import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vitest';

const testOnWindows = process.platform === 'win32' ? test : test.skip;
const moduleDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(moduleDir, '..', '..');
const builtMainEntry = resolve(
  repoRoot,
  'dist-desktop',
  'gui',
  'main',
  'index.js',
);
const electronCliEntry = resolve(
  repoRoot,
  'node_modules',
  'electron',
  'cli.js',
);

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // Electron can keep temp user-data files open briefly after shutdown.
      }
    }
  }
});

// Task 11 library-shell smoke. The legacy probe clicked sidebar tabs and
// exercised Coverage/Data explorers; those surfaces were deleted in Task 9.
// The new probe confirms: (a) the built app launches without uncaught errors,
// (b) archive:state returns, (c) either the EmptyStateWelcome or the
// LibraryShell heading is mounted.
testOnWindows(
  'boots the built desktop app and mounts either LibraryShell or EmptyStateWelcome',
  { timeout: 90_000 },
  async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-smoke-'));
    cleanupPaths.push(tempRoot);

    const userDataRoot = join(tempRoot, 'user-data');
    const markerPath = join(tempRoot, 'desktop-smoke-report.json');
    mkdirSync(userDataRoot, { recursive: true });

    // Run in the repo root so resolveArchiveRoot's cwd probe finds the
    // archive/ folder next to the repo, exercising the LibraryShell path.
    // Absent an archive we expect EmptyStateWelcome to mount instead.
    const desktopEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PBINFO_DESKTOP_TEST_USER_DATA_ROOT: userDataRoot,
      PBINFO_DESKTOP_TEST_MARKER_PATH: markerPath,
    };
    delete desktopEnv.ELECTRON_RUN_AS_NODE;

    const desktopProcess = spawn(
      process.execPath,
      [electronCliEntry, builtMainEntry],
      {
        cwd: repoRoot,
        env: desktopEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    desktopProcess.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    desktopProcess.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    try {
      const report = await waitForDesktopSmokeReport(markerPath, () => ({
        stdout,
        stderr,
        exitCode: desktopProcess.exitCode,
      }));
      if (report.error) {
        throw new Error(
          `Desktop smoke probe failed: ${JSON.stringify(report, null, 2)}`,
        );
      }
      expect(report.phase).toBe('completed');
      // One of the two shells must have mounted.
      const shellMounted = Boolean(
        report.libraryShellMounted || report.emptyStateMounted,
      );
      expect(shellMounted).toBe(true);
      // If the library shell mounted, we expect real rows.
      if (report.libraryShellMounted) {
        expect(report.rowCount ?? 0).toBeGreaterThan(0);
      }
      // Headings should include either the welcome copy or the library-shell
      // title (both contain "problem archive crawler").
      const headings = report.finalHeadings ?? [];
      expect(
        headings.some((h) => /problem archive crawler/i.test(h)),
      ).toBe(true);
    } finally {
      await closeDesktopProcess(desktopProcess.pid);
    }
  },
);

async function waitForDesktopSmokeReport(
  path: string,
  getProcessState: () => {
    stdout: string;
    stderr: string;
    exitCode: number | null;
  },
): Promise<DesktopSmokeReport> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      const report = JSON.parse(readFileSync(path, 'utf8')) as DesktopSmokeReport;
      if (report.phase === 'completed' || report.phase === 'error') {
        return report;
      }
    } catch {
      // Marker is either missing or mid-write; keep polling.
    }

    await delay(250);
  }

  const processState = getProcessState();
  const partialReport = existsSync(path)
    ? readFileSync(path, 'utf8')
    : '<missing>';
  throw new Error(
    `Timed out waiting for desktop smoke report at ${path}. Partial report: ${partialReport}. Stdout: ${processState.stdout || '<empty>'}. Stderr: ${processState.stderr || '<empty>'}. Exit code: ${processState.exitCode ?? '<running>'}.`,
  );
}

async function closeDesktopProcess(
  processId: number | undefined,
): Promise<void> {
  if (!processId) {
    return;
  }

  try {
    spawnSync('taskkill', ['/PID', String(processId), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    // The wrapper process can already be gone after the smoke test exits cleanly.
  }
}

interface DesktopSmokeReport {
  readonly phase?: string;
  readonly error?: string;
  readonly archiveFound?: boolean;
  readonly archiveSnapshotId?: string;
  readonly probedPaths?: readonly string[];
  readonly libraryShellMounted?: boolean;
  readonly emptyStateMounted?: boolean;
  readonly finalHeadings?: readonly string[];
  readonly rowCount?: number;
  readonly text?: string;
}
