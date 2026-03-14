import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = resolve(process.cwd());
const releaseRoot = resolve(repoRoot, 'release-desktop');

async function main(): Promise<void> {
  assertWindows();

  const { portableExePath, smokeTargetExePath } = resolvePackagedOutputs();
  const tempRoot = mkdtempSync(join(tmpdir(), 'pbinfo-packaged-smoke-'));
  const userDataRoot = join(tempRoot, 'user-data');
  const workspaceRoot = repoRoot;
  const markerPath = join(tempRoot, 'desktop-smoke-report.json');
  const actionsPath = join(tempRoot, 'desktop-smoke-actions.json');

  const desktopEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PBINFO_DESKTOP_TEST_USER_DATA_ROOT: userDataRoot,
    PBINFO_DESKTOP_TEST_WORKSPACE_ROOT: workspaceRoot,
    PBINFO_DESKTOP_TEST_MARKER_PATH: markerPath,
    PBINFO_DESKTOP_TEST_ACTIONS_PATH: actionsPath,
    PBINFO_DESKTOP_TEST_DRY_RUN_OPENERS: '1',
  };
  delete desktopEnv.ELECTRON_RUN_AS_NODE;

  const desktopProcess = spawn(smokeTargetExePath, [], {
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
    const report = await waitForDesktopSmokeReport(markerPath, 60_000);
    const actions = await waitForJsonFile<DesktopSmokeAction[]>(actionsPath, 10_000);

    if (report.phase !== 'completed') {
      throw new Error(
        `Packaged desktop smoke probe failed: ${JSON.stringify(report, null, 2)}`,
      );
    }

    const datasetLabels = report.dataExplorer?.datasetLabels ?? [];
    const expectedDatasets = ['Problems', 'Evaluations', 'Rankings', 'Mirror Routes'];
    for (const label of expectedDatasets) {
      if (!datasetLabels.includes(label)) {
        throw new Error(
          `Packaged desktop smoke probe did not expose dataset chip "${label}".`,
        );
      }
    }

    const actionKinds = actions.map((action) => action.kind);
    if (!actionKinds.includes('openPath') || !actionKinds.includes('openExternal')) {
      throw new Error(
        `Packaged desktop smoke probe did not resolve archive open actions. Actions: ${JSON.stringify(actions, null, 2)}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          portableExePath,
          smokeTargetExePath,
          workspaceRoot,
          markerPath,
          actionsPath,
          report,
          actions,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    throw new Error(
      `Packaged desktop smoke failed for ${smokeTargetExePath}. Portable exe: ${portableExePath}. Stdout: ${stdout || '<empty>'}. Stderr: ${stderr || '<empty>'}. ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    closeDesktopProcess(desktopProcess.pid);
    try {
      rmSync(tempRoot, {
        recursive: true,
        force: true,
      });
    } catch {
      // The packaged app can keep user-data files open briefly after taskkill.
    }
  }
}

function resolvePackagedOutputs(): {
  portableExePath: string;
  smokeTargetExePath: string;
} {
  if (!existsSync(releaseRoot)) {
    throw new Error(`release-desktop does not exist: ${releaseRoot}`);
  }

  const exeNames = readdirSync(releaseRoot).filter(
    (name) => /^Problem Archive Crawler .*\.exe$/i.test(name),
  );
  const legacyExeNames = readdirSync(releaseRoot).filter(
    (name) => /^PBInfo Archive Desktop .*\.exe$/i.test(name),
  );

  if (legacyExeNames.length > 0) {
    throw new Error(
      `Legacy PBInfo-branded desktop executables must not remain in release-desktop: ${legacyExeNames.join(', ')}`,
    );
  }

  if (exeNames.length !== 1) {
    throw new Error(
      `Expected exactly one branded Problem Archive Crawler executable in release-desktop, found ${exeNames.length}.`,
    );
  }

  const portableExePath = join(releaseRoot, exeNames[0]!);
  const smokeTargetExePath = join(
    releaseRoot,
    'win-unpacked',
    'Problem Archive Crawler.exe',
  );

  if (!existsSync(smokeTargetExePath)) {
    throw new Error(
      `Expected desktop:pack to leave an unpacked smoke target at ${smokeTargetExePath}.`,
    );
  }

  return {
    portableExePath,
    smokeTargetExePath,
  };
}

async function waitForJsonFile<T>(path: string, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for JSON file: ${path}`);
}

async function waitForDesktopSmokeReport(
  path: string,
  timeoutMs: number,
): Promise<DesktopSmokeReport> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const report = JSON.parse(readFileSync(path, 'utf8')) as DesktopSmokeReport;
      if (report.phase === 'completed' || report.phase === 'error') {
        return report;
      }
    } catch {
      // Keep polling until the marker is fully written.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for completed desktop smoke report: ${path}`);
}

function closeDesktopProcess(processId: number | undefined): void {
  if (!processId) {
    return;
  }

  try {
    spawnSync('taskkill', ['/PID', String(processId), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    // The packaged app can already be gone by the time cleanup runs.
  }
}

function assertWindows(): void {
  if (process.platform !== 'win32') {
    throw new Error('The packaged desktop smoke flow is supported only on Windows.');
  }
}

interface DesktopSmokeReport {
  phase?: string;
  dataExplorer?: {
    datasetLabels?: string[];
  };
}

interface DesktopSmokeAction {
  kind: 'openPath' | 'openExternal';
  target: string;
}

void main();
