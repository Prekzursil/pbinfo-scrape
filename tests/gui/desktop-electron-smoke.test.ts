import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vitest';

const testOnWindows = process.platform === 'win32' ? test : test.skip;
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const builtMainEntry = resolve(repoRoot, 'dist-desktop', 'gui', 'main', 'index.js');
const electronCliEntry = resolve(repoRoot, 'node_modules', 'electron', 'cli.js');

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      try {
        rmSync(path, {
          recursive: true,
          force: true,
        });
      } catch {
        // Electron can keep temp user-data files open briefly after shutdown.
      }
    }
  }
});

testOnWindows(
  'boots the built desktop app and completes first-launch workspace selection',
  {
    timeout: 90_000,
  },
  async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-smoke-'));
    cleanupPaths.push(tempRoot);

    const userDataRoot = join(tempRoot, 'user-data');
    const workspaceRoot = join(tempRoot, 'workspace');
    const markerPath = join(tempRoot, 'desktop-smoke-report.json');
    mkdirSync(userDataRoot, {
      recursive: true,
    });
    const desktopEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PBINFO_DESKTOP_TEST_USER_DATA_ROOT: userDataRoot,
      PBINFO_DESKTOP_TEST_MARKER_PATH: markerPath,
      PBINFO_DESKTOP_TEST_WORKSPACE_ROOT: workspaceRoot,
    };
    delete desktopEnv.ELECTRON_RUN_AS_NODE;

    const desktopProcess = spawn(process.execPath, [electronCliEntry, builtMainEntry], {
      cwd: repoRoot,
      env: desktopEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
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
        throw new Error(`Desktop smoke probe failed: ${JSON.stringify(report, null, 2)}`);
      }
      expect(report.phase).toBe('completed');
      expect(report.initial?.headings).toContain('Choose a workspace');
      expect(report.final?.headings).toContain('Workspace Summary');
      expect(report.final?.headings).toContain('Profile Login and Import');
      expect(report.final?.text).toContain(workspaceRoot);
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
    }

    await delay(250);
  }

  const processState = getProcessState();
  const partialReport = existsSync(path) ? readFileSync(path, 'utf8') : '<missing>';
  throw new Error(
    `Timed out waiting for desktop smoke report at ${path}. Partial report: ${partialReport}. Stdout: ${processState.stdout || '<empty>'}. Stderr: ${processState.stderr || '<empty>'}. Exit code: ${processState.exitCode ?? '<running>'}.`,
  );
}

async function closeDesktopProcess(processId: number | undefined): Promise<void> {
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
  phase?: string;
  error?: string;
  initial?: {
    headings?: string[];
    text?: string;
  };
  final?: {
    headings?: string[];
    text?: string;
  };
}
