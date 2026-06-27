import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.hoisted(() => ({ loginWithCredentials: vi.fn() }));

vi.mock('../../src/config/local-config.js', () => ({
  loadLocalConfig: vi.fn(),
}));
vi.mock('../../src/auth/cookie-import.js', () => ({
  importBrowserCookies: vi.fn(async () => []),
  normalizeImportedCookies: vi.fn(() => [
    { name: 'k', value: 'v', domain: 'd', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' },
  ]),
}));
vi.mock('../../src/auth/auth-bundle.js', () => ({
  createEncryptedAuthBundle: vi.fn(async () => ({ bundlePath: 'b' })),
  restoreEncryptedAuthBundle: vi.fn(async () => ({ restored: true })),
}));
vi.mock('../../src/auth/pbinfo-auth.js', () => ({
  PbinfoAuthClient: vi.fn(() => ({ loginWithCredentials: authMock.loginWithCredentials })),
}));
vi.mock('../../src/auth/auth-status.js', () => ({
  probePbinfoAuthStatus: vi.fn(async () => ({ authenticated: true })),
}));
vi.mock('../../src/auth/session-store.js', () => ({
  persistSerializedCookies: vi.fn(),
}));
vi.mock('../../src/artifacts/raw-artifacts.js', () => ({
  exportRawSnapshotArtifacts: vi.fn(async () => ({ snapshotId: 's' })),
  importRawSnapshotArtifacts: vi.fn(async () => ({ snapshotId: 's' })),
  relinkRawSnapshotArtifacts: vi.fn(async () => ({ snapshotId: 's' })),
}));
vi.mock('../../src/mirror/build-mirror.js', () => ({
  buildMirrorArtifacts: vi.fn(async () => ({ pages: 1 })),
}));
vi.mock('../../src/mirror/server.js', () => ({
  startMirrorServer: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:4173' })),
}));
vi.mock('../../src/publish/publish.js', () => ({
  publishWorkspace: vi.fn(() => ({ pushed: true })),
}));
vi.mock('../../src/workflows/crawl-workflow.js', () => ({
  runCrawlWorkflow: vi.fn(async () => ({ scope: 'public' })),
  resumeCrawlWorkflow: vi.fn(async () => ({ resumed: true })),
  runOfficialSourceHarvestWorkflow: vi.fn(async () => ({ harvested: 1 })),
}));
vi.mock('../../src/workflows/normalize-workflow.js', () => ({
  runNormalizeSnapshotWorkflow: vi.fn(async () => ({ normalized: 1 })),
}));
vi.mock('../../src/workflows/rank-workflow.js', () => ({
  runRankingWorkflow: vi.fn(async () => ({ ranked: 1 })),
}));
vi.mock('../../src/workflows/snapshot-workflow.js', () => ({
  finalizeSnapshotWorkflow: vi.fn(async () => ({ finalized: true })),
  getCrawlStatus: vi.fn(() => ({ queue: 0 })),
}));

const { buildCli, runCli } = await import('../../src/cli.js');
const { loadLocalConfig } = await import('../../src/config/local-config.js');
const { runCrawlWorkflow } = await import('../../src/workflows/crawl-workflow.js');
const { exportRawSnapshotArtifacts, importRawSnapshotArtifacts } = await import(
  '../../src/artifacts/raw-artifacts.js'
);
const { startMirrorServer } = await import('../../src/mirror/server.js');

const tempDirs: string[] = [];
let stdoutSpy: { mockRestore: () => void };

function credentialsConfig() {
  return {
    auth: {
      strategy: 'credentials',
      username: 'u',
      password: 'p',
      sessionCookiesPath: join(tmpdir(), 'pbinfo-cli-sc.json'),
    },
  };
}

async function run(args: string[]): Promise<void> {
  await buildCli().parseAsync(['node', 'pbinfo', ...args]);
}

beforeEach(() => {
  vi.mocked(loadLocalConfig).mockReturnValue(credentialsConfig() as never);
  authMock.loginWithCredentials.mockResolvedValue({ success: true, handle: 'u' });
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('default CLI handlers', () => {
  test('authLogin writes the successful login result', async () => {
    await run(['auth', 'login']);
    expect(authMock.loginWithCredentials).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalled();
  });

  test('authLogin throws when the config is not credential-based', async () => {
    vi.mocked(loadLocalConfig).mockReturnValue({ auth: { strategy: 'none', sessionCookiesPath: 'x' } } as never);
    await expect(run(['auth', 'login'])).rejects.toThrow(/Credential login requires/);
  });

  test('authLogin throws on an unsuccessful login, using the default reason when none is given', async () => {
    authMock.loginWithCredentials.mockResolvedValue({ success: false });
    await expect(run(['auth', 'login'])).rejects.toThrow(/did not create an authenticated session/);

    authMock.loginWithCredentials.mockResolvedValue({ success: false, failureReason: 'bad password' });
    await expect(run(['auth', 'login'])).rejects.toThrow('bad password');
  });

  test('authStatus probes and reports auth state', async () => {
    await run(['auth', 'status']);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  test('authImportCookies reads, normalizes, and persists cookies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pbinfo-cli-cookies-'));
    tempDirs.push(dir);
    const source = join(dir, 'cookies.json');
    writeFileSync(source, '[]', 'utf8');
    await run(['auth', 'import-cookies', '--source', source]);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  test('authImportBrowser imports with and without an explicit profile', async () => {
    await run(['auth', 'import-browser', '--browser', 'edge', '--profile', 'Work']);
    await run(['auth', 'import-browser', '--browser', 'chrome']);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  test('authBundle and restore-bundle run through the secrets handlers', async () => {
    await run(['auth', 'bundle']);
    await run(['secrets', 'bootstrap', '--recipient', 'age1abc']);
    await run(['auth', 'restore-bundle', '--source', 'b.age']);
    await run(['secrets', 'restore', '--source', 'b.age', '--identity', 'id.txt']);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  test('crawl handlers cover acceptance and canonical checkpoints', async () => {
    await run(['crawl', 'public', '--acceptance']);
    expect(runCrawlWorkflow).toHaveBeenLastCalledWith(process.cwd(), 'public', {
      snapshotId: undefined,
      checkpoint: 'checkpoint',
      mode: 'incremental',
    });
    await run(['crawl', 'all', '--snapshot', 's', '--mode', 'fresh']);
    expect(runCrawlWorkflow).toHaveBeenLastCalledWith(process.cwd(), 'all', {
      snapshotId: 's',
      checkpoint: 'canonical',
      mode: 'fresh',
    });
    await run(['crawl', 'official-sources', '--snapshot', 's']);
    await run(['crawl', 'status']);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  test('normalize, snapshot finalize, and rank handlers run', async () => {
    await run(['normalize', 'snapshot']);
    await run(['snapshot', 'finalize', '--snapshot', 's', '--promote']);
    await run(['rank']);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  test('artifacts handlers default the snapshot id to latest when omitted', async () => {
    await run(['artifacts', 'export-raw']);
    expect(exportRawSnapshotArtifacts).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshotId: 'latest' }),
    );
    await run(['artifacts', 'export-raw', '--snapshot', 's', '--target', '/out']);
    await run(['artifacts', 'import-raw', '--source', '/m.json']);
    expect(importRawSnapshotArtifacts).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshotId: 'latest' }),
    );
    await run(['artifacts', 'relink-raw', '--snapshot', 's', '--source', '/m.json']);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  test('build-mirror, serve, resume, and publish handlers run', async () => {
    await run(['build-mirror']);
    await run(['serve', '--port', '5050']);
    expect(startMirrorServer).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 5050 }),
    );
    await run(['serve']);
    expect(startMirrorServer).toHaveBeenLastCalledWith(expect.objectContaining({ port: 4173 }));
    await run(['resume']);
    await run(['publish', '--snapshot', 's', '--release', '--tag', 'v1.0.0', '--upload-desktop-exe']);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  test('runCli parses argv through the default program', async () => {
    await runCli(['node', 'pbinfo', 'crawl', 'status']);
    expect(stdoutSpy).toHaveBeenCalled();
  });
});
