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
    const workspaceRoot = repoRoot;
    const markerPath = join(tempRoot, 'desktop-smoke-report.json');
    const actionsPath = join(tempRoot, 'desktop-smoke-actions.json');
    mkdirSync(userDataRoot, {
      recursive: true,
    });
    const desktopEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PBINFO_DESKTOP_TEST_USER_DATA_ROOT: userDataRoot,
      PBINFO_DESKTOP_TEST_MARKER_PATH: markerPath,
      PBINFO_DESKTOP_TEST_WORKSPACE_ROOT: workspaceRoot,
      PBINFO_DESKTOP_TEST_ACTIONS_PATH: actionsPath,
      PBINFO_DESKTOP_TEST_DRY_RUN_OPENERS: '1',
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
      expect(report.final?.headings).toContain('Archive Overview');
      expect(report.final?.headings).toContain('What happens next');
      expect(report.final?.headings).toContain('Recent activity');
      expect(report.final?.headings).toContain('Mirror access');
      expect(report.final?.text).toContain(workspaceRoot);
      expect(report.coverageExplorer?.summary?.totalProblems).toBeGreaterThan(0);
      expect(report.coverageExplorer?.summary?.solvedByMeCount).toBeGreaterThanOrEqual(0);
      expect(report.coverageExplorer?.listing?.totalCount).toBeGreaterThan(0);
      expect(report.coverageExplorer?.detail?.problemId).toBeTruthy();
      expect(report.dataExplorer?.snapshotId).toBe('acceptance-20260310b');
      expect(report.dataExplorer?.datasetLabels).toEqual(
        expect.arrayContaining(['Problems', 'Evaluations', 'Rankings', 'Mirror Routes']),
      );
      expect(report.dataExplorer?.visitedDatasets).toEqual(
        expect.arrayContaining(['Problems', 'Evaluations', 'Rankings', 'Mirror Routes']),
      );
      expect(report.dataExplorer?.datasetListings?.problems?.totalCount).toBeGreaterThan(0);
      expect(report.dataExplorer?.datasetListings?.problems?.detailTitle).toBeTruthy();
      const actions = JSON.parse(readFileSync(actionsPath, 'utf8')) as DesktopSmokeAction[];
      expect(actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'openPath',
          }),
          expect.objectContaining({
            kind: 'openExternal',
          }),
        ]),
      );
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
      // The report file may not exist yet or be mid-write; retry after a delay.
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
  dataExplorer?: {
    snapshotId?: string;
    datasetLabels?: string[];
    visitedDatasets?: string[];
    datasetListings?: {
      problems?: {
        totalCount?: number;
        detailTitle?: string | null;
      };
    };
  } | null;
  coverageExplorer?: {
    summary?: {
      totalProblems?: number;
      solvedByMeCount?: number;
      problemsWithArchivedSources?: number;
    };
    listing?: {
      totalCount?: number;
      firstProblemId?: number | null;
      firstProblemName?: string | null;
    };
    detail?: {
      problemId?: number;
      name?: string;
      solvedByMe?: boolean;
      testsFragmentArchived?: boolean;
      visibleTestsCapturedCount?: number;
      officialSourceArchived?: boolean;
      userSourceArchived?: boolean;
      editorialAvailability?: string;
    } | null;
  } | null;
}

interface DesktopSmokeAction {
  kind: 'openPath' | 'openExternal';
  target: string;
}
