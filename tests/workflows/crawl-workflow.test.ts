import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { readArchiveCatalog } from '../../src/archive/storage.js';
import { CrawlQueue, readCrawlQueueSnapshot } from '../../src/crawl/crawl-queue.js';
import {
  getCrawlStatusWorkflow,
  resumeCrawlWorkflow,
  runCrawlWorkflow,
  runOfficialSourceHarvestWorkflow,
} from '../../src/workflows/crawl-workflow.js';

const tempDirs: string[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('runCrawlWorkflow', () => {
  test('fails authenticated crawl when auth preflight reports a guest session', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-auth-preflight-guest-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            userHandle: 'Prekzursil',
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      runCrawlWorkflow(workspaceRoot, 'user', {
        maxIterations: 0,
        authStatusProbe: async () => ({
          status: 'guest',
          loggedIn: false,
          configuredHandle: 'prekzursil',
          resolvedHandle: undefined,
          handleMatchesConfigured: false,
          cookieFileExists: true,
          sessionCookiesPath: join(workspaceRoot, '.local', 'session-cookies.json'),
          probeUrl: 'https://www.pbinfo.ro/',
          checkedAt: '2026-03-10T00:00:00.000Z',
          remediation: ['re-login required'],
        }),
      }),
    ).rejects.toThrow(/preflight failed/i);
  });

  test('starts authenticated crawl when auth preflight confirms the configured handle', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-auth-preflight-ok-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            userHandle: 'Prekzursil',
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runCrawlWorkflow(workspaceRoot, 'user', {
      maxIterations: 0,
      now: new Date('2026-03-10T00:00:00.000Z'),
      authStatusProbe: async () => ({
        status: 'ok',
        loggedIn: true,
        configuredHandle: 'prekzursil',
        resolvedHandle: 'prekzursil',
        handleMatchesConfigured: true,
        cookieFileExists: true,
        sessionCookiesPath: join(workspaceRoot, '.local', 'session-cookies.json'),
        probeUrl: 'https://www.pbinfo.ro/',
        checkedAt: '2026-03-10T00:00:00.000Z',
        remediation: [],
      }),
    });

    expect(result.processed).toBe(0);
    expect(result.snapshotId).toBe('20260310T000000Z');
    expect(result.completed).toBe(false);
    const queueSnapshot = readCrawlQueueSnapshot(
      join(workspaceRoot, '.local', 'crawl-queues', '20260310T000000Z.sqlite'),
    );
    expect(queueSnapshot.items).toEqual([
      expect.objectContaining({
        key: 'page:https://www.pbinfo.ro/solutii/user/Prekzursil',
        url: 'https://www.pbinfo.ro/solutii/user/Prekzursil',
        kind: 'user-solutions',
      }),
    ]);
  });

  test('seeds, processes, and archives a small public crawl', { timeout: 20_000 }, async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <html>
            <head><link rel="stylesheet" href="/site.css"></head>
            <body><a href="/probleme">Probleme</a></body>
          </html>
        `);
        return;
      }

      if (request.url === '/probleme') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><h1>Probleme</h1></body></html>');
        return;
      }

      if (request.url === '/site.css') {
        response.setHeader('Content-Type', 'text/css');
        response.end('body { color: red; }');
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            publicStartUrls: [`${baseUrl}/`],
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runCrawlWorkflow(workspaceRoot, 'public', {
      maxIterations: 10,
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    const rawSnapshotRoot = join(
      workspaceRoot,
      'output',
      'artifacts',
      result.snapshotId,
      'raw-pages',
    );

    expect(result.processed).toBe(3);
    expect(readFileSync(join(rawSnapshotRoot, 'page-http-127-0-0-1-root.html'), 'utf8')).toContain(
      '<a href="/probleme">Probleme</a>',
    );
    expect(readFileSync(join(rawSnapshotRoot, 'page-http-127-0-0-1-probleme.html'), 'utf8')).toContain(
      '<h1>Probleme</h1>',
    );
    expect(
      readFileSync(
        join(
          workspaceRoot,
          'output',
          'artifacts',
          result.snapshotId,
          'raw-assets',
          'asset-http-127-0-0-1-site-css.css',
        ),
        'utf8',
      ),
    ).toContain(
      'body { color: red; }',
    );
  });

  test('uses persisted session cookies when crawling authenticated pages', { timeout: 20_000 }, async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-auth-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    const server = createServer((request, response) => {
      if (request.url === '/secure') {
        if (!request.headers.cookie?.includes('SESSION_ID=abc123')) {
          response.statusCode = 403;
          response.end('forbidden');
          return;
        }

        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><h1>Authenticated</h1></body></html>');
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    writeFileSync(
      join(workspaceRoot, '.local', 'session-cookies.json'),
      JSON.stringify(
        [
          {
            key: 'SESSION_ID',
            value: 'abc123',
            domain: '127.0.0.1',
            path: '/',
            expires: 'Infinity',
            httpOnly: true,
            secure: false,
          },
        ],
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            publicStartUrls: [`http://127.0.0.1:${address.port}/secure`],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runCrawlWorkflow(workspaceRoot, 'public', {
      maxIterations: 1,
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    expect(result.processed).toBe(1);
    expect(
      readFileSync(
        join(
          workspaceRoot,
          'output',
          'artifacts',
          result.snapshotId,
          'raw-pages',
          'page-http-127-0-0-1-secure.html',
        ),
        'utf8',
      ),
    ).toContain('Authenticated');
  });

  test('resumes the latest unfinished snapshot instead of starting a new one', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-resume-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><a href="/probleme">Probleme</a></body></html>');
        return;
      }

      if (request.url === '/probleme') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><h1>Probleme</h1></body></html>');
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            publicStartUrls: [`${baseUrl}/`],
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const firstPass = await runCrawlWorkflow(workspaceRoot, 'public', {
      maxIterations: 1,
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    expect(firstPass.completed).toBe(false);

    const resumed = await resumeCrawlWorkflow(workspaceRoot, {
      maxIterations: 10,
      now: new Date('2026-03-10T00:10:00.000Z'),
    });

    const catalog = readArchiveCatalog(join(workspaceRoot, 'archive'));

    expect(resumed.snapshotId).toBe(firstPass.snapshotId);
    expect(resumed.completed).toBe(true);
    expect(catalog.currentSnapshotId).toBe(firstPass.snapshotId);
    expect(catalog.snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshotId: firstPass.snapshotId,
          createdAt: '2026-03-10T00:00:00.000Z',
          status: 'completed',
        }),
      ]),
    );
  });

  test('resumes an explicitly requested snapshot even when a newer in-progress snapshot exists', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-resume-specific-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><a href="/probleme">Probleme</a></body></html>');
        return;
      }

      if (request.url === '/probleme') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><h1>Probleme</h1></body></html>');
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            publicStartUrls: [`${baseUrl}/`],
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const canonicalPass = await runCrawlWorkflow(workspaceRoot, 'public', {
      snapshotId: 'acceptance-20260310b',
      maxIterations: 1,
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const newerPass = await runCrawlWorkflow(workspaceRoot, 'public', {
      snapshotId: '20260310T122126Z',
      maxIterations: 1,
      now: new Date('2026-03-10T00:05:00.000Z'),
    });

    expect(canonicalPass.completed).toBe(false);
    expect(newerPass.completed).toBe(false);

    const resumed = await resumeCrawlWorkflow(workspaceRoot, {
      snapshotId: 'acceptance-20260310b',
      maxIterations: 10,
      now: new Date('2026-03-10T00:10:00.000Z'),
    });
    const catalog = readArchiveCatalog(join(workspaceRoot, 'archive'));

    expect(resumed.snapshotId).toBe('acceptance-20260310b');
    expect(catalog.currentSnapshotId).toBe('acceptance-20260310b');
  });

  test('incremental mode reuses the canonical snapshot instead of creating a new one', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-incremental-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><h1>Probleme</h1></body></html>');
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            publicStartUrls: [`http://127.0.0.1:${address.port}/`],
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const initial = await runCrawlWorkflow(workspaceRoot, 'public', {
      snapshotId: 'acceptance-20260310b',
      maxIterations: 5,
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    const rerun = await runCrawlWorkflow(workspaceRoot, 'public', {
      now: new Date('2026-03-10T00:05:00.000Z'),
      maxIterations: 5,
      mode: 'incremental',
    } as never);

    const catalog = readArchiveCatalog(join(workspaceRoot, 'archive'));

    expect(initial.completed).toBe(true);
    expect(rerun.snapshotId).toBe('acceptance-20260310b');
    expect(catalog.currentSnapshotId).toBe('acceptance-20260310b');
    expect(catalog.canonicalSnapshotId).toBe('acceptance-20260310b');
    expect(catalog.snapshots.map((snapshot) => snapshot.snapshotId)).toEqual([
      'acceptance-20260310b',
    ]);
  });

  test('fresh mode creates a new snapshot without overwriting the canonical snapshot pointer', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-fresh-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><h1>Probleme</h1></body></html>');
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            publicStartUrls: [`http://127.0.0.1:${address.port}/`],
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await runCrawlWorkflow(workspaceRoot, 'public', {
      snapshotId: 'acceptance-20260310b',
      maxIterations: 5,
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    const fresh = await runCrawlWorkflow(workspaceRoot, 'public', {
      now: new Date('2026-03-10T00:05:00.000Z'),
      maxIterations: 5,
      mode: 'fresh',
    } as never);

    const catalog = readArchiveCatalog(join(workspaceRoot, 'archive'));

    expect(fresh.snapshotId).toBe('20260310T000500Z');
    expect(catalog.currentSnapshotId).toBe('20260310T000500Z');
    expect(catalog.canonicalSnapshotId).toBe('acceptance-20260310b');
    expect(catalog.snapshots.map((snapshot) => snapshot.snapshotId).sort()).toEqual([
      '20260310T000500Z',
      'acceptance-20260310b',
    ]);
  });

  test('reports crawl status and recent failures for a snapshot queue', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-status-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body>Resursă indisponibilă temporar.</body></html>');
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            publicStartUrls: [`http://127.0.0.1:${address.port}/`],
            crossCheckWithBrowser: false,
            retryDelayMs: 60_000,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runCrawlWorkflow(workspaceRoot, 'public', {
      maxIterations: 1,
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    const status = getCrawlStatusWorkflow(workspaceRoot, result.snapshotId);

    expect(status.pending).toBe(1);
    expect(status.completed).toBe(0);
    expect(status.inProgress).toBe(0);
    expect(status.publishEligible).toBe(false);
    expect(status.recentFailures).toEqual([
      expect.objectContaining({
        url: `http://127.0.0.1:${address.port}/`,
        attemptCount: 1,
        lastError: 'temporarily unavailable',
      }),
    ]);
  });

  test('seeds targeted official-source harvest from normalized problem identities via official solution fragments', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-official-source-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            publicStartUrls: [],
            userHandle: 'Prekzursil',
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const snapshotRoot = join(
      workspaceRoot,
      'archive',
      'snapshots',
      'candidate-20260316-1900',
      'normalized',
      'problems',
    );
    mkdirSync(snapshotRoot, { recursive: true });
    writeFileSync(
      join(snapshotRoot, 'problem-1.json'),
      JSON.stringify(
        {
          id: 1,
          slug: 'sum',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/1/sum',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/sum',
          metadata: {
            authorHandle: 'Prekzursil',
            'postată de': 'Silviu Candale (silviu)',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshotRoot, 'problem-2.json'),
      JSON.stringify({ id: 2 }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, 'archive', 'catalog.json'),
      JSON.stringify(
        {
          version: 1,
          currentSnapshotId: 'candidate-20260316-1900',
          canonicalSnapshotId: 'acceptance-20260310b',
          snapshots: [
            {
              snapshotId: 'candidate-20260316-1900',
              createdAt: '2026-03-16T19:00:00.000Z',
              scope: 'all',
              status: 'in_progress',
              checkpoint: 'canonical',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runOfficialSourceHarvestWorkflow(workspaceRoot, {
      maxIterations: 0,
      snapshotId: 'candidate-20260316-1900',
      now: new Date('2026-03-16T19:05:00.000Z'),
      authStatusProbe: async () => ({
        status: 'ok',
        loggedIn: true,
        configuredHandle: 'prekzursil',
        resolvedHandle: 'prekzursil',
        handleMatchesConfigured: true,
        cookieFileExists: true,
        sessionCookiesPath: join(workspaceRoot, '.local', 'session-cookies.json'),
        probeUrl: 'https://www.pbinfo.ro/',
        checkedAt: '2026-03-16T19:05:00.000Z',
        remediation: [],
      }),
    });

    const queueState = getCrawlStatusWorkflow(workspaceRoot, result.snapshotId);
    const queueSnapshot = readCrawlQueueSnapshot(queueState.queuePath);

    expect(result.snapshotId).toBe('candidate-20260316-1900');
    expect(result.processed).toBe(0);
    expect(queueState.pending).toBe(1);
    expect(queueSnapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'official-source-list:https://www.pbinfo.ro/solutii/user/silviu/problema/1/sum',
          url: 'https://www.pbinfo.ro/solutii/user/silviu/problema/1/sum',
          kind: 'official-source-list',
        }),
      ]),
    );
  });

  test('falls back to the public source-list URL when no official author handle is available', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-official-source-public-fallback-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            publicStartUrls: [],
            userHandle: 'Prekzursil',
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const snapshotRoot = join(
      workspaceRoot,
      'archive',
      'snapshots',
      'candidate-20260316-1900',
      'normalized',
      'problems',
    );
    mkdirSync(snapshotRoot, { recursive: true });
    writeFileSync(
      join(snapshotRoot, 'problem-1.json'),
      JSON.stringify(
        {
          id: 1,
          slug: 'sum',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/1/sum',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/sum',
          metadata: {
            'postată de': 'Silviu Candale',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, 'archive', 'catalog.json'),
      JSON.stringify(
        {
          version: 1,
          currentSnapshotId: 'candidate-20260316-1900',
          canonicalSnapshotId: 'acceptance-20260310b',
          snapshots: [
            {
              snapshotId: 'candidate-20260316-1900',
              createdAt: '2026-03-16T19:00:00.000Z',
              scope: 'all',
              status: 'in_progress',
              checkpoint: 'canonical',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runOfficialSourceHarvestWorkflow(workspaceRoot, {
      maxIterations: 0,
      snapshotId: 'candidate-20260316-1900',
      now: new Date('2026-03-16T19:05:00.000Z'),
      authStatusProbe: async () => ({
        status: 'ok',
        loggedIn: true,
        configuredHandle: 'prekzursil',
        resolvedHandle: 'prekzursil',
        handleMatchesConfigured: true,
        cookieFileExists: true,
        sessionCookiesPath: join(workspaceRoot, '.local', 'session-cookies.json'),
        probeUrl: 'https://www.pbinfo.ro/',
        checkedAt: '2026-03-16T19:05:00.000Z',
        remediation: [],
      }),
    });

    const queueState = getCrawlStatusWorkflow(workspaceRoot, result.snapshotId);
    const queueSnapshot = readCrawlQueueSnapshot(queueState.queuePath);

    expect(queueState.pending).toBe(1);
    expect(queueSnapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'official-source-list:https://www.pbinfo.ro/solutii/problema/1/sum',
          url: 'https://www.pbinfo.ro/solutii/problema/1/sum',
          kind: 'official-source-list',
        }),
      ]),
    );
  });

  test('fails targeted official-source harvest when auth preflight reports a guest session', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-official-source-auth-guest-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            publicStartUrls: [],
            userHandle: 'Prekzursil',
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const snapshotRoot = join(
      workspaceRoot,
      'archive',
      'snapshots',
      'candidate-20260316-1900',
      'normalized',
      'problems',
    );
    mkdirSync(snapshotRoot, { recursive: true });
    writeFileSync(
      join(snapshotRoot, 'problem-1.json'),
      JSON.stringify(
        {
          id: 1,
          slug: 'sum',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/sum',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, 'archive', 'catalog.json'),
      JSON.stringify(
        {
          version: 1,
          currentSnapshotId: 'candidate-20260316-1900',
          canonicalSnapshotId: 'acceptance-20260310b',
          snapshots: [
            {
              snapshotId: 'candidate-20260316-1900',
              createdAt: '2026-03-16T19:00:00.000Z',
              scope: 'all',
              status: 'in_progress',
              checkpoint: 'canonical',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      runOfficialSourceHarvestWorkflow(workspaceRoot, {
        maxIterations: 0,
        snapshotId: 'candidate-20260316-1900',
        now: new Date('2026-03-16T19:05:00.000Z'),
        authStatusProbe: async () => ({
          status: 'guest',
          loggedIn: false,
          configuredHandle: 'prekzursil',
          resolvedHandle: undefined,
          handleMatchesConfigured: false,
          cookieFileExists: true,
          sessionCookiesPath: join(workspaceRoot, '.local', 'session-cookies.json'),
          probeUrl: 'https://www.pbinfo.ro/',
          checkedAt: '2026-03-16T19:05:00.000Z',
          remediation: ['re-login required'],
        }),
      }),
    ).rejects.toThrow(/preflight failed/i);
  });

  test('requeues targeted official source-list harvest even if the generic public crawl already completed the same source-list page', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-official-source-rerun-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            publicStartUrls: [],
            userHandle: 'Prekzursil',
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const snapshotRoot = join(
      workspaceRoot,
      'archive',
      'snapshots',
      'candidate-20260316-1900',
      'normalized',
      'problems',
    );
    mkdirSync(snapshotRoot, { recursive: true });
    writeFileSync(
      join(snapshotRoot, 'problem-1.json'),
      JSON.stringify(
        {
          id: 1,
          slug: 'sum',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/1/sum',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/1/sum',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, 'archive', 'catalog.json'),
      JSON.stringify(
        {
          version: 1,
          currentSnapshotId: 'candidate-20260316-1900',
          canonicalSnapshotId: 'acceptance-20260310b',
          snapshots: [
            {
              snapshotId: 'candidate-20260316-1900',
              createdAt: '2026-03-16T19:00:00.000Z',
              scope: 'all',
              status: 'in_progress',
              checkpoint: 'canonical',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const queuePath = join(
      workspaceRoot,
      '.local',
      'crawl-queues',
      'candidate-20260316-1900.sqlite',
    );
    const queue = new CrawlQueue(queuePath);
    queue.enqueueMany([
      {
        key: 'page:https://www.pbinfo.ro/solutii/problema/1/sum',
        url: 'https://www.pbinfo.ro/solutii/problema/1/sum',
        kind: 'public-page',
      },
    ]);
    const existingItem = queue.claimNext(new Date('2026-03-16T19:00:00.000Z'));
    expect(existingItem?.key).toBe('page:https://www.pbinfo.ro/solutii/problema/1/sum');
    if (existingItem) {
      queue.complete(existingItem.id, {
        httpStatus: 200,
        contentHash: 'sha256:existing',
      });
    }
    queue.close();

    await runOfficialSourceHarvestWorkflow(workspaceRoot, {
      maxIterations: 0,
      snapshotId: 'candidate-20260316-1900',
      now: new Date('2026-03-16T19:05:00.000Z'),
      authStatusProbe: async () => ({
        status: 'ok',
        loggedIn: true,
        configuredHandle: 'prekzursil',
        resolvedHandle: 'prekzursil',
        handleMatchesConfigured: true,
        cookieFileExists: true,
        sessionCookiesPath: join(workspaceRoot, '.local', 'session-cookies.json'),
        probeUrl: 'https://www.pbinfo.ro/',
        checkedAt: '2026-03-16T19:05:00.000Z',
        remediation: [],
      }),
    });

    const queueSnapshot = readCrawlQueueSnapshot(queuePath);
    expect(queueSnapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'page:https://www.pbinfo.ro/solutii/problema/1/sum',
          status: 'completed',
        }),
        expect.objectContaining({
          key: 'official-source-list:https://www.pbinfo.ro/solutii/problema/1/sum',
          status: 'pending',
        }),
      ]),
    );
  });

  test('uses crawl.maxConcurrency to overlap independent requests', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-concurrency-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    let activeRequests = 0;
    let maxActiveRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === '/a' || request.url === '/b') {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        setTimeout(() => {
          response.setHeader('Content-Type', 'text/html');
          response.end(`<html><body>${request.url}</body></html>`);
          activeRequests -= 1;
        }, 500);
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            maxConcurrency: 2,
            publicStartUrls: [
              `http://127.0.0.1:${address.port}/a`,
              `http://127.0.0.1:${address.port}/b`,
            ],
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runCrawlWorkflow(workspaceRoot, 'public', {
      maxIterations: 2,
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    expect(result.processed).toBe(2);
    expect(maxActiveRequests).toBe(2);
  });

  test('retries temporarily unavailable pages within the same run using fresh time checks', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-retry-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    let attempts = 0;
    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        if (attempts === 0) {
          attempts += 1;
          setTimeout(() => {
            response.end('<html><body>Resursă indisponibilă temporar.</body></html>');
          }, 5);
          return;
        }

        response.end('<html><body><h1>Recovered</h1></body></html>');
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            publicStartUrls: [`http://127.0.0.1:${address.port}/`],
            crossCheckWithBrowser: false,
            retryDelayMs: 1,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runCrawlWorkflow(workspaceRoot, 'public', {
      maxIterations: 3,
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    expect(result.completed).toBe(true);
    expect(result.processed).toBe(2);
    expect(
      readFileSync(
        join(
          workspaceRoot,
          'output',
          'artifacts',
          result.snapshotId,
          'raw-pages',
          'page-http-127-0-0-1-root.html',
        ),
        'utf8',
      ),
    ).toContain('Recovered');
  });

  test('handles concurrent follow-up enqueue without locking the queue database', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-workflow-followups-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    let activeRequests = 0;
    let maxActiveRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === '/a' || request.url === '/b') {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        setTimeout(() => {
          response.setHeader('Content-Type', 'text/html');
          response.end(
            `<html><body><a href="${request.url}/child">child</a></body></html>`,
          );
          activeRequests -= 1;
        }, 500);
        return;
      }

      if (request.url === '/a/child' || request.url === '/b/child') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<html><body>${request.url}</body></html>`);
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            maxConcurrency: 2,
            publicStartUrls: [
              `http://127.0.0.1:${address.port}/a`,
              `http://127.0.0.1:${address.port}/b`,
            ],
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runCrawlWorkflow(workspaceRoot, 'public', {
      maxIterations: 10,
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    expect(result.completed).toBe(true);
    expect(result.processed).toBe(4);
    expect(maxActiveRequests).toBe(2);
  });
});
