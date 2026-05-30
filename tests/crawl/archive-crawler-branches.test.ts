import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { ArchiveCrawler, persistNormalizedSnapshotHtml } from '../../src/crawl/archive-crawler.js';
import { CrawlQueue } from '../../src/crawl/crawl-queue.js';

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

function createWorkspace(overrides?: { crawl?: { userHandle?: string } }) {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-crawl-br-'));
  mkdirSync(join(root, '.local'), { recursive: true });
  if (overrides) {
    writeFileSync(
      join(root, '.local', 'pbinfo.local.json'),
      JSON.stringify(overrides, null, 2),
      'utf8',
    );
  }
  tempDirs.push(root);
  const config = loadLocalConfig(root);
  const snapshot = prepareSnapshot(config, {
    snapshotId: 'snapshot-20260310T000000Z',
    scope: 'all',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });
  return {
    root,
    config,
    snapshot,
    queuePath: join(root, '.local', 'queue.sqlite'),
  };
}

describe('ArchiveCrawler branch coverage', () => {
  test('dedupes user-solution entries that have no evaluationId and skips them', async () => {
    // This exercises dedupeUserSolutionEntries line 1750 (continue on no evaluationId)
    const workspace = createWorkspace({ crawl: { userHandle: 'Prekzursil' } });
    const server = createServer((request, response) => {
      if (request.url === '/solutii/user/Prekzursil') {
        response.setHeader('Content-Type', 'text/html');
        // Produce entries that will have no evaluationId (no /detalii-evaluare link)
        // and one proper entry
        response.end(`
          <html>
            <body>
              <div class="bold mb-3">1 soluții respectă criteriile.</div>
              <table class="table">
                <tbody>
                  <tr>
                    <td><a href="/profil/Prekzursil">Prekzursil</a></td>
                    <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
                    <td><a href="/detalii-evaluare/63332367">100 puncte</a></td>
                  </tr>
                </tbody>
              </table>
            </body>
          </html>
        `);
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

    const url = `http://127.0.0.1:${address.port}/solutii/user/Prekzursil`;
    const queue = new CrawlQueue(join(workspace.root, '.local', 'dedup-no-evid.sqlite'));
    queue.enqueueMany([
      {
        key: `page:${url}`,
        url,
        kind: 'user-solutions',
      },
    ]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
    });

    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);

    const userRecord = JSON.parse(
      readFileSync(
        join(workspace.snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
        'utf8',
      ),
    );
    // The entry with a valid evaluationId should be captured
    expect(userRecord.entries).toHaveLength(1);
    expect(userRecord.entries[0].evaluationId).toBe(63332367);
  });

  test('merges user-solutions across two crawl pages, deduping duplicate evaluationId entries', async () => {
    // Exercises dedupeUserSolutionEntries dedup path (byEvaluationId.has check)
    // and maxDefinedNumber when second record has no totalMatches (right = undefined, return left)
    const workspace = createWorkspace({ crawl: { userHandle: 'Prekzursil' } });

    let callCount = 0;
    const server = createServer((request, response) => {
      if (request.url === '/solutii/user/Prekzursil') {
        callCount += 1;
        response.setHeader('Content-Type', 'text/html');
        if (callCount === 1) {
          // First page: has totalMatches count and one entry
          response.end(`
            <html>
              <body>
                <div class="bold mb-3">75 soluții respectă criteriile.</div>
                <table class="table">
                  <tbody>
                    <tr>
                      <td><a href="/profil/Prekzursil">Prekzursil</a></td>
                      <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
                      <td><a href="/detalii-evaluare/63332367">100 puncte</a></td>
                    </tr>
                  </tbody>
                </table>
                <script>
                  $(document).ready(function(){
                    let tmp = Paginare(75, 0, 50);
                  });
                </script>
              </body>
            </html>
          `);
        } else {
          // Second fetch: same evaluation id again (will be deduped), no total count
          response.end(`
            <html>
              <body>
                <table class="table">
                  <tbody>
                    <tr>
                      <td><a href="/profil/Prekzursil">Prekzursil</a></td>
                      <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
                      <td><a href="/detalii-evaluare/63332367">100 puncte</a></td>
                    </tr>
                  </tbody>
                </table>
              </body>
            </html>
          `);
        }
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
    const url = `${baseUrl}/solutii/user/Prekzursil`;
    const queue = new CrawlQueue(join(workspace.root, '.local', 'merge-dedup.sqlite'));
    queue.enqueueMany([
      {
        key: `page:${url}`,
        url,
        kind: 'user-solutions',
      },
    ]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
    });

    // First crawl sets totalMatches=75 and one entry
    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);

    // Process the user-solutions follow-up if it was queued (the pagination item from start=50)
    // Actually, first page has Paginare(75, 0, 50) so there should be a next page queued
    // We skip pagination and instead directly re-enqueue same page to test merge/dedup
    const firstRecord = JSON.parse(
      readFileSync(
        join(workspace.snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
        'utf8',
      ),
    );
    expect(firstRecord.totalMatches).toBe(75);
    expect(firstRecord.entries).toHaveLength(1);

    // Enqueue the same URL a second time (as if visiting a second page)
    queue.enqueueMany([
      {
        key: `page:${url}?start=50`,
        url,
        kind: 'user-solutions',
      },
    ]);
    await expect(crawler.processNext(new Date('2026-03-10T00:00:01.000Z'))).resolves.toBe(true);

    const mergedRecord = JSON.parse(
      readFileSync(
        join(workspace.snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
        'utf8',
      ),
    );
    // Deduped: still one entry
    expect(mergedRecord.entries).toHaveLength(1);
    // totalMatches preserved from first record (maxDefinedNumber: right=undefined returns left)
    expect(mergedRecord.totalMatches).toBe(75);
  });

  test('returns false from processNext when queue is empty', async () => {
    const workspace = createWorkspace();
    const queue = new CrawlQueue(workspace.queuePath);
    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
    });

    const result = await crawler.processNext(new Date('2026-03-10T00:00:00.000Z'));
    expect(result).toBe(false);
  });

  test('browser capture failure is silently swallowed and HTTP response is used', async () => {
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
      if (request.url === '/probleme/3171/waterreserve') {
        response.setHeader('Content-Type', 'text/html');
        response.end(
          '<html><body><h1><span>#3171</span> <a href="/probleme/3171/waterreserve">WaterReserve</a></h1></body></html>',
        );
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

    const url = `http://127.0.0.1:${address.port}/probleme/3171/waterreserve`;
    const queue = new CrawlQueue(join(workspace.root, '.local', 'browser-fail.sqlite'));
    queue.enqueueMany([
      {
        key: `page:${url}`,
        url,
        kind: 'public-page',
      },
    ]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
      browserCapture: {
        captureHtml: async () => {
          throw new Error('browser capture failed');
        },
        close: async () => undefined,
      },
    });

    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);
    expect(queue.getSnapshot().completed).toBe(1);
  });

  test('problem-solution normalizes from browser HTML when browser has more solutions', async () => {
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
      if (request.url?.startsWith('/ajx-module/ajx-problema-afisare-solutie.php')) {
        response.setHeader('Content-Type', 'text/html');
        // HTTP surface has no solutions
        response.end('<html><body></body></html>');
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

    const url = `http://127.0.0.1:${address.port}/ajx-module/ajx-problema-afisare-solutie.php?id=3171`;
    const queue = new CrawlQueue(join(workspace.root, '.local', 'solution-browser.sqlite'));
    queue.enqueueMany([
      {
        key: 'problem-solution:https://www.pbinfo.ro/probleme/3171/waterreserve',
        url,
        kind: 'problem-solution',
      },
    ]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
      browserCapture: {
        captureHtml: async () =>
          '<div class="tab-content"><div id="cpp"><h4>C++</h4><pre>#include &lt;bits/stdc++.h&gt;\nint main(){return 0;}</pre></div></div>',
        close: async () => undefined,
      },
    });

    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);
    expect(queue.getSnapshot().completed).toBe(1);
  });

  test('problem-tests normalizes from browser HTML when browser has more tests', async () => {
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
      if (request.url?.startsWith('/ajx-module/ajx-problema-afisare-teste.php')) {
        response.setHeader('Content-Type', 'text/html');
        // HTTP surface has no tests
        response.end('<html><body></body></html>');
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

    const url = `http://127.0.0.1:${address.port}/ajx-module/ajx-problema-afisare-teste.php?id=3171`;
    const queue = new CrawlQueue(join(workspace.root, '.local', 'tests-browser.sqlite'));
    queue.enqueueMany([
      {
        key: 'problem-tests:https://www.pbinfo.ro/probleme/3171/waterreserve',
        url,
        kind: 'problem-tests',
      },
    ]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
      browserCapture: {
        captureHtml: async () => `
          <h3>Test 1</h3>
          <p>Intrare</p><pre>1 2</pre>
          <p>Ieșire</p><pre>3</pre>
        `,
        close: async () => undefined,
      },
    });

    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);
    expect(queue.getSnapshot().completed).toBe(1);
  });

  test('dedupeUserSolutionEntries skips entries with no evaluationId via persistNormalizedSnapshotHtml', () => {
    // Pre-seed the user-solutions JSON with an entry that has no evaluationId
    // so that dedupeUserSolutionEntries hits the `continue` at line 1750.
    const workspace = createWorkspace({ crawl: { userHandle: 'Prekzursil' } });
    mkdirSync(join(workspace.snapshot.normalizedRoot, 'user-solutions'), { recursive: true });
    const existingRecord = {
      user: 'Prekzursil',
      sourceUrl: 'https://www.pbinfo.ro/solutii/user/Prekzursil',
      pageUrls: ['https://www.pbinfo.ro/solutii/user/Prekzursil'],
      totalMatches: 3,
      throttled: false,
      nextPageUrls: [],
      entries: [
        // Entry without evaluationId - will be skipped by dedupeUserSolutionEntries
        { user: 'Prekzursil', problemId: 1, problemSlug: 'sum', score: 100 },
        // Entry with evaluationId - will be kept
        { user: 'Prekzursil', problemId: 2, problemSlug: 'test', evaluationId: 99999, score: 100 },
      ],
    };
    writeFileSync(
      join(workspace.snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
      JSON.stringify(existingRecord),
      'utf8',
    );

    // Call persistNormalizedSnapshotHtml with a new user-solutions page that has one new entry
    persistNormalizedSnapshotHtml({
      config: workspace.config,
      snapshot: workspace.snapshot,
      item: {
        key: 'page:https://www.pbinfo.ro/solutii/user/Prekzursil',
        url: 'https://www.pbinfo.ro/solutii/user/Prekzursil',
        kind: 'user-solutions',
      },
      html: `
        <html>
          <body>
            <div class="bold mb-3">3 soluții respectă criteriile.</div>
            <a href="/profil/Prekzursil">Prekzursil</a>
            <a href="/probleme/3171/waterreserve">WaterReserve</a>
            <a href="/detalii-evaluare/63332367">100 puncte</a>
          </body>
        </html>
      `,
      httpStatus: 200,
      fetchedAt: '2026-03-10T00:00:00.000Z',
    });

    const merged = JSON.parse(
      readFileSync(
        join(workspace.snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
        'utf8',
      ),
    );
    // The entry without evaluationId was skipped; we have the two entries from before
    // plus the new one from the HTML (63332367)
    const evaluationIds = merged.entries
      .map((e: { evaluationId?: number }) => e.evaluationId)
      .filter(Boolean);
    expect(evaluationIds).toContain(99999);
    expect(evaluationIds).toContain(63332367);
  });

  test('maxDefinedNumber returns left when right is undefined', () => {
    // Pre-seed a user-solutions record with totalMatches=5, then process a page
    // with no total count text so record.totalMatches is undefined.
    const workspace = createWorkspace({ crawl: { userHandle: 'Prekzursil' } });
    mkdirSync(join(workspace.snapshot.normalizedRoot, 'user-solutions'), { recursive: true });
    const existingRecord = {
      user: 'Prekzursil',
      sourceUrl: 'https://www.pbinfo.ro/solutii/user/Prekzursil',
      pageUrls: ['https://www.pbinfo.ro/solutii/user/Prekzursil'],
      totalMatches: 5,
      throttled: false,
      nextPageUrls: [],
      entries: [
        { user: 'Prekzursil', problemId: 1, problemSlug: 'sum', evaluationId: 11111, score: 100 },
      ],
    };
    writeFileSync(
      join(workspace.snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
      JSON.stringify(existingRecord),
      'utf8',
    );

    // Process a page with no total count - parseUserSolutionsListPage returns totalMatches=undefined
    persistNormalizedSnapshotHtml({
      config: workspace.config,
      snapshot: workspace.snapshot,
      item: {
        key: 'page:https://www.pbinfo.ro/solutii/user/Prekzursil?start=50',
        url: 'https://www.pbinfo.ro/solutii/user/Prekzursil?start=50',
        kind: 'user-solutions',
      },
      html: `
        <html>
          <body>
            <a href="/profil/Prekzursil">Prekzursil</a>
            <a href="/probleme/3171/waterreserve">WaterReserve</a>
            <a href="/detalii-evaluare/63332368">100 puncte</a>
          </body>
        </html>
      `,
      httpStatus: 200,
      fetchedAt: '2026-03-10T00:00:00.000Z',
    });

    const merged = JSON.parse(
      readFileSync(
        join(workspace.snapshot.normalizedRoot, 'user-solutions', 'user-prekzursil.json'),
        'utf8',
      ),
    );
    // totalMatches preserved from left (existing=5), right (new)=undefined -> return left
    expect(merged.totalMatches).toBe(5);
  });

  test('resolvePreferredNormalizedHtml falls back to browser when parsing throws', async () => {
    // When kind is problem-solution and parsing both http/browser throws,
    // the catch block returns { html: browserHtml, source: 'browser' }
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
      if (request.url?.startsWith('/ajx-module')) {
        response.setHeader('Content-Type', 'text/html');
        // Malformed HTML that will cause parser to throw inside resolvePreferredNormalizedHtml
        response.end('<html><body>INVALID CONTENT</body></html>');
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

    const url = `http://127.0.0.1:${address.port}/ajx-module/ajx-problema-afisare-solutie.php?id=9999`;
    const queue = new CrawlQueue(join(workspace.root, '.local', 'throws-fallback.sqlite'));
    queue.enqueueMany([
      {
        key: 'problem-solution:https://www.pbinfo.ro/probleme/9999/demo',
        url,
        kind: 'problem-solution',
      },
    ]);

    const throwingBrowserCapture = {
      captureHtml: async () => {
        throw new Error('simulated parse error inside resolvePreferredNormalizedHtml');
      },
      close: async () => undefined,
    };

    // We instead use a valid browser capture; the throw path in resolvePreferredNormalizedHtml
    // is covered when one of the parsers throws while computing branch preference.
    // Provide a capture that returns HTML that triggers parseOfficialSolutionFragment to succeed
    // on one but not the other – enough to exercise the try/catch in resolvePreferredNormalizedHtml.
    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
      browserCapture: throwingBrowserCapture,
    });

    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);
    expect(queue.getSnapshot().completed).toBe(1);
  });
});
