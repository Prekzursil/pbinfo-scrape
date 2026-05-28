import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';

const loginWithCredentials = vi.fn();

vi.mock('../../src/auth/cookie-import.js', () => ({
  importBrowserCookies: vi.fn(async () => [{ name: 'PHPSESSID', value: 'v' }]),
  normalizeImportedCookies: vi.fn((payload: unknown) =>
    Array.isArray(payload) ? payload : [{ name: 'k', value: 'v' }],
  ),
}));
vi.mock('../../src/auth/auth-bundle.js', () => ({
  createEncryptedAuthBundle: vi.fn(async () => ({ bundlePath: '/bundle.age' })),
  restoreEncryptedAuthBundle: vi.fn(async () => ({ restored: 2 })),
}));
vi.mock('../../src/auth/pbinfo-auth.js', () => ({
  PbinfoAuthClient: class {
    loginWithCredentials = loginWithCredentials;
  },
}));
vi.mock('../../src/auth/auth-status.js', () => ({
  probePbinfoAuthStatus: vi.fn(async () => ({ authenticated: true })),
}));
vi.mock('../../src/auth/session-store.js', () => ({
  persistSerializedCookies: vi.fn(),
}));
vi.mock('../../src/artifacts/raw-artifacts.js', () => ({
  exportRawSnapshotArtifacts: vi.fn(async () => ({ exported: true })),
  importRawSnapshotArtifacts: vi.fn(async () => ({ imported: true })),
  relinkRawSnapshotArtifacts: vi.fn(async () => ({ relinked: true })),
}));
vi.mock('../../src/config/local-config.js', () => ({
  loadLocalConfig: vi.fn(() => ({
    auth: {
      strategy: 'credentials',
      username: 'Prekzursil',
      password: 'secret',
      sessionCookiesPath: '/cookies.json',
    },
  })),
}));
vi.mock('../../src/mirror/build-mirror.js', () => ({
  buildMirrorArtifacts: vi.fn(async () => ({ built: true })),
}));
vi.mock('../../src/mirror/server.js', () => ({
  startMirrorServer: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:4173' })),
}));
vi.mock('../../src/publish/publish.js', () => ({
  publishWorkspace: vi.fn(() => ({ published: true })),
}));
vi.mock('../../src/workflows/crawl-workflow.js', () => ({
  runCrawlWorkflow: vi.fn(async () => ({ processed: 3 })),
  resumeCrawlWorkflow: vi.fn(async () => ({ resumed: true })),
  runOfficialSourceHarvestWorkflow: vi.fn(async () => ({ harvested: 1 })),
}));
vi.mock('../../src/workflows/normalize-workflow.js', () => ({
  runNormalizeSnapshotWorkflow: vi.fn(async () => ({ normalized: 4 })),
}));
vi.mock('../../src/workflows/rank-workflow.js', () => ({
  runRankingWorkflow: vi.fn(async () => ({ ranked: 5 })),
}));
vi.mock('../../src/workflows/snapshot-workflow.js', () => ({
  finalizeSnapshotWorkflow: vi.fn(async () => ({ finalized: true })),
  getCrawlStatus: vi.fn(() => ({ pending: 0 })),
}));
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify([{ name: 'k', value: 'v' }])),
}));

const { buildCli } = await import('../../src/cli.js');
const { loadLocalConfig } = await import('../../src/config/local-config.js');

let stdout: string[];
let stdoutSpy: MockInstance;

async function run(args: string[]): Promise<void> {
  await buildCli().parseAsync(['node', 'pbinfo', ...args]);
}

beforeEach(() => {
  stdout = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  loginWithCredentials.mockResolvedValue({ success: true, sessionCookies: [] });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  vi.clearAllMocks();
});

describe('CLI default handlers', () => {
  test('auth login prints the login result on success', async () => {
    await run(['auth', 'login']);
    expect(stdout.join('')).toContain('success');
  });

  test('auth login rejects when credentials are incomplete', async () => {
    vi.mocked(loadLocalConfig).mockReturnValueOnce({
      auth: { strategy: 'token', sessionCookiesPath: '/cookies.json' },
    } as never);
    await expect(run(['auth', 'login'])).rejects.toThrow(/Credential login requires/);
  });

  test('auth login rejects when the login attempt fails', async () => {
    loginWithCredentials.mockResolvedValueOnce({ success: false, failureReason: 'bad creds' });
    await expect(run(['auth', 'login'])).rejects.toThrow('bad creds');
  });

  test('auth login surfaces a default failure reason when none is provided', async () => {
    loginWithCredentials.mockResolvedValueOnce({ success: false });
    await expect(run(['auth', 'login'])).rejects.toThrow(/did not create an authenticated session/);
  });

  test('auth status, import-cookies, import-browser, bundle, restore-bundle all print output', async () => {
    await run(['auth', 'status']);
    await run(['auth', 'import-cookies', '--source', '/c.json']);
    await run(['auth', 'import-browser', '--browser', 'edge']);
    await run(['auth', 'bundle']);
    await run(['auth', 'restore-bundle', '--source', '/b.age']);

    const out = stdout.join('');
    expect(out).toContain('authenticated');
    expect(out).toContain('imported');
    expect(out).toContain('bundlePath');
    expect(out).toContain('restored');
  });

  test('crawl, normalize, snapshot, rank, and resume handlers print results', async () => {
    await run(['crawl', 'all', '--snapshot', 's1', '--acceptance']);
    await run(['crawl', 'public']);
    await run(['crawl', 'official-sources', '--snapshot', 's2']);
    await run(['crawl', 'status']);
    await run(['normalize', 'snapshot']);
    await run(['snapshot', 'finalize', '--snapshot', 'f1', '--promote']);
    await run(['rank']);
    await run(['resume']);

    const out = stdout.join('');
    expect(out).toContain('processed');
    expect(out).toContain('harvested');
    expect(out).toContain('pending');
    expect(out).toContain('normalized');
    expect(out).toContain('finalized');
    expect(out).toContain('ranked');
    expect(out).toContain('resumed');
  });

  test('artifacts, build-mirror, serve, and publish handlers print results', async () => {
    await run(['artifacts', 'export-raw']);
    await run(['artifacts', 'import-raw', '--source', '/s']);
    await run(['artifacts', 'relink-raw', '--snapshot', 'l1', '--source', '/m']);
    await run(['build-mirror']);
    await run(['serve']);
    await run(['publish']);

    const out = stdout.join('');
    expect(out).toContain('exported');
    expect(out).toContain('imported');
    expect(out).toContain('relinked');
    expect(out).toContain('built');
    expect(out).toContain('http://127.0.0.1:4173');
    expect(out).toContain('published');
  });

  test('serve honors an explicit port override', async () => {
    const { startMirrorServer } = await import('../../src/mirror/server.js');
    await run(['serve', '--port', '8080']);
    expect(vi.mocked(startMirrorServer)).toHaveBeenCalledWith(
      expect.objectContaining({ port: 8080 }),
    );
  });
});
