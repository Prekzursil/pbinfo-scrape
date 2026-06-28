import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const browserMock = vi.hoisted(() => ({
  createPlaywrightBrowserCapture: vi.fn(),
}));

vi.mock('../../src/crawl/browser-capture.js', () => ({
  createPlaywrightBrowserCapture: browserMock.createPlaywrightBrowserCapture,
}));

const { buildQueuePath, markSnapshotCompleted, prepareSnapshot } = await import('../../src/archive/storage.js');
const { loadLocalConfig } = await import('../../src/config/local-config.js');
const { CrawlQueue } = await import('../../src/crawl/crawl-queue.js');
const {
  createRateLimitedFetch,
  getCrawlStatusWorkflow,
  resumeCrawlWorkflow,
  runCrawlWorkflow,
  runOfficialSourceHarvestWorkflow,
} = await import('../../src/workflows/crawl-workflow.js');

const tempDirs: string[] = [];
const servers: Server[] = [];

beforeEach(() => {
  browserMock.createPlaywrightBrowserCapture.mockReset();
  browserMock.createPlaywrightBrowserCapture.mockResolvedValue({
    captureHtml: async () => '<html></html>',
    close: async () => undefined,
  });
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(localConfig: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-crawl-edges-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.local'), { recursive: true });
  writeFileSync(join(root, '.local', 'pbinfo.local.json'), JSON.stringify(localConfig), 'utf8');
  return root;
}

const okProbe = async () => ({
  status: 'ok' as const,
  loggedIn: true,
  configuredHandle: 'alice',
  resolvedHandle: 'alice',
  handleMatchesConfigured: true,
  cookieFileExists: true,
  sessionCookiesPath: 'x',
  probeUrl: 'https://www.pbinfo.ro/',
  checkedAt: '2026-01-01T00:00:00Z',
  remediation: [],
});

describe('createRateLimitedFetch', () => {
  test('bypasses non-pbinfo hosts and rate-limits pbinfo across input shapes', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (input: unknown) => {
      calls.push(String((input as { url?: string }).url ?? input));
      return { ok: true } as unknown as Response;
    }) as unknown as typeof fetch;
    const limited = createRateLimitedFetch(fakeFetch, 5);

    await limited('https://example.com/x');
    await limited(new URL('https://www.pbinfo.ro/a'));
    await limited('https://www.pbinfo.ro/b');
    await limited({ url: 'https://pbinfo.ro/c' } as unknown as Request);
    await limited({} as unknown as Request);

    expect(calls).toHaveLength(5);
  });
});

describe('enforceAuthPreflight', () => {
  test('throws when an authenticated scope has no configured handle', async () => {
    const root = workspace({ crawl: { crossCheckWithBrowser: false } });
    await expect(runCrawlWorkflow(root, 'user', { maxIterations: 0, authStatusProbe: okProbe })).rejects.toThrow(
      /requires crawl.userHandle/,
    );
  });

  test('throws when the resolved handle does not match', async () => {
    const root = workspace({ crawl: { userHandle: 'alice', crossCheckWithBrowser: false } });
    await expect(
      runCrawlWorkflow(root, 'user', {
        maxIterations: 0,
        authStatusProbe: async () => ({ ...(await okProbe()), resolvedHandle: 'other' }),
      }),
    ).rejects.toThrow(/does not match active session/);
  });

  test('reports an unknown session handle when none was resolved', async () => {
    const root = workspace({ crawl: { userHandle: 'alice', crossCheckWithBrowser: false } });
    await expect(
      runCrawlWorkflow(root, 'user', {
        maxIterations: 0,
        authStatusProbe: async () => ({ ...(await okProbe()), resolvedHandle: undefined }),
      }),
    ).rejects.toThrow(/active session "unknown"/);
  });
});

describe('runCrawlWorkflow seeds', () => {
  test('seeds an authenticated user crawl and completes when budget is zero', async () => {
    const root = workspace({ crawl: { userHandle: 'alice', crossCheckWithBrowser: false } });
    const result = await runCrawlWorkflow(root, 'user', { maxIterations: 0, authStatusProbe: okProbe });
    expect(result.processed).toBe(0);
    expect(result.completed).toBe(false);
  });

  test('falls back to an undefined browser capture when launch fails', async () => {
    browserMock.createPlaywrightBrowserCapture.mockRejectedValueOnce(new Error('no chromium'));
    const root = workspace({ crawl: { crossCheckWithBrowser: true } });
    const result = await runCrawlWorkflow(root, 'public', { maxIterations: 0 });
    expect(result.snapshotId).toBeTruthy();
  });

  test('closes a successfully launched browser capture', async () => {
    const close = vi.fn(async () => undefined);
    browserMock.createPlaywrightBrowserCapture.mockResolvedValueOnce({ captureHtml: async () => '', close });
    const root = workspace({ crawl: { crossCheckWithBrowser: true } });
    await runCrawlWorkflow(root, 'public', { maxIterations: 0 });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('runOfficialSourceHarvestWorkflow', () => {
  test('throws when no snapshot is available', async () => {
    const root = workspace({ crawl: { userHandle: 'alice', crossCheckWithBrowser: false } });
    await expect(runOfficialSourceHarvestWorkflow(root, { authStatusProbe: okProbe })).rejects.toThrow(
      /No snapshot is available/,
    );
  });

  test('throws when the snapshot has no source-list urls', async () => {
    const root = workspace({ crawl: { userHandle: 'alice', crossCheckWithBrowser: false } });
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'SNAP', scope: 'all', checkpoint: 'canonical', now: new Date() });
    await expect(
      runOfficialSourceHarvestWorkflow(root, { authStatusProbe: okProbe }),
    ).rejects.toThrow(/No problem source-list URLs/);
  });

  test('builds author-scoped seeds from problem metadata', async () => {
    const root = workspace({ crawl: { userHandle: 'alice', crossCheckWithBrowser: false } });
    const config = loadLocalConfig(root);
    const snapshot = prepareSnapshot(config, { snapshotId: 'SNAP', scope: 'all', checkpoint: 'canonical', now: new Date() });
    const problemsRoot = join(snapshot.normalizedRoot, 'problems');
    mkdirSync(problemsRoot, { recursive: true });
    writeFileSync(
      join(problemsRoot, 'p1.json'),
      JSON.stringify({ id: 1, slug: 'sum', sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/sum', metadata: { 'postată de': 'Teacher (teach)' } }),
      'utf8',
    );
    writeFileSync(
      join(problemsRoot, 'p2.json'),
      JSON.stringify({ id: 2, slug: 'diff', sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/2/diff', metadata: { authorHandle: 'admin' } }),
      'utf8',
    );
    writeFileSync(
      join(problemsRoot, 'p3.json'),
      JSON.stringify({ sourceListUrl: 'https://www.pbinfo.ro/altceva', metadata: {} }),
      'utf8',
    );
    writeFileSync(join(problemsRoot, 'p4.json'), JSON.stringify({ id: 4, slug: 'x' }), 'utf8');
    writeFileSync(
      join(problemsRoot, 'p5.json'),
      JSON.stringify({ id: 5, slug: 'm', sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/5/m', metadata: { 'postata de': 'Plain (plain)' } }),
      'utf8',
    );
    writeFileSync(
      join(problemsRoot, 'p6.json'),
      JSON.stringify({ id: 6, slug: 'w', sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/6/w', metadata: { authorHandle: '   ' } }),
      'utf8',
    );
    writeFileSync(
      join(problemsRoot, 'p7.json'),
      JSON.stringify({ id: 7, slug: 'q', sourceListUrl: 'https://www.pbinfo.ro/weird-path', metadata: { authorHandle: 'someone' } }),
      'utf8',
    );

    const result = await runOfficialSourceHarvestWorkflow(root, { maxIterations: 0, authStatusProbe: okProbe });
    expect(result.snapshotId).toBe('SNAP');
  });

  test('resolves the current snapshot when no canonical snapshot exists', async () => {
    const root = workspace({ crawl: { userHandle: 'alice', crossCheckWithBrowser: false } });
    const config = loadLocalConfig(root);
    const snapshot = prepareSnapshot(config, { snapshotId: 'CHK', scope: 'all', checkpoint: 'checkpoint', now: new Date() });
    const problemsRoot = join(snapshot.normalizedRoot, 'problems');
    mkdirSync(problemsRoot, { recursive: true });
    writeFileSync(
      join(problemsRoot, 'p1.json'),
      JSON.stringify({ id: 1, slug: 'sum', sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/sum' }),
      'utf8',
    );
    const result = await runOfficialSourceHarvestWorkflow(root, { maxIterations: 0, authStatusProbe: okProbe });
    expect(result.snapshotId).toBe('CHK');
  });

  test('seeds an authenticated all-scope crawl', async () => {
    const root = workspace({ crawl: { userHandle: 'alice', crossCheckWithBrowser: false } });
    const result = await runCrawlWorkflow(root, 'all', { maxIterations: 0, authStatusProbe: okProbe });
    expect(result.completed).toBe(false);
  });

  test('uses the real auth probe when none is injected', async () => {
    const root = workspace({ crawl: { userHandle: 'alice', crossCheckWithBrowser: false } });
    await expect(runCrawlWorkflow(root, 'user', { maxIterations: 0 })).rejects.toThrow(/preflight failed/);
  });
});

describe('resumeCrawlWorkflow & status', () => {
  test('throws when there is no unfinished snapshot to resume', async () => {
    const root = workspace({ crawl: { crossCheckWithBrowser: false } });
    await expect(resumeCrawlWorkflow(root, {})).rejects.toThrow(/No unfinished snapshot/);
  });

  test('resumes the latest in-progress public snapshot', async () => {
    const root = workspace({ crawl: { crossCheckWithBrowser: false } });
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'INPROG', scope: 'public', now: new Date() });
    const result = await resumeCrawlWorkflow(root, { maxIterations: 0 });
    expect(result.snapshotId).toBe('INPROG');
  });

  test('throws status lookup when no snapshot exists', () => {
    const root = workspace();
    expect(() => getCrawlStatusWorkflow(root)).toThrow(/No archived snapshot/);
  });

  test('reports recent failures and publish eligibility', () => {
    const root = workspace({ crawl: { crossCheckWithBrowser: false } });
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'STAT', scope: 'public', now: new Date() });
    const queue = new CrawlQueue(buildQueuePath(config.paths.localRoot, 'STAT'));
    queue.enqueueMany([{ key: 'k', url: 'https://x/', kind: 'public-page' }]);
    const claimed = queue.claimNext(new Date());
    queue.fail(claimed!.id, { errorMessage: 'boom', nextVisibleAt: '2026-01-02T00:00:00Z' });

    const status = getCrawlStatusWorkflow(root, 'STAT');
    expect(status.recentFailures[0]?.lastError).toBe('boom');
    expect(status.publishEligible).toBe(false);
  });

  test('runs an unbounded crawl against a trivial local page', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<html><body>no links here</body></html>');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('no address');
    }
    const root = workspace({
      crawl: {
        crossCheckWithBrowser: false,
        maxConcurrency: 1,
        publicStartUrls: [`http://127.0.0.1:${address.port}/`],
      },
    });
    // No maxIterations -> infinite budget; the trivial page drains in one fetch.
    const result = await runCrawlWorkflow(root, 'public', {});
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.completed).toBe(true);
  });

  test('marks a fully drained completed snapshot as publish-eligible', () => {
    const root = workspace({ crawl: { crossCheckWithBrowser: false } });
    const config = loadLocalConfig(root);
    prepareSnapshot(config, { snapshotId: 'DONE', scope: 'public', now: new Date() });
    markSnapshotCompleted(config, 'DONE');
    const queue = new CrawlQueue(buildQueuePath(config.paths.localRoot, 'DONE'));
    queue.enqueueMany([{ key: 'k', url: 'https://x/', kind: 'public-page' }]);
    const claimed = queue.claimNext(new Date());
    queue.complete(claimed!.id, {});

    const status = getCrawlStatusWorkflow(root, 'DONE');
    expect(status.publishEligible).toBe(true);
    expect(status.recentFailures).toEqual([]);
  });
});
