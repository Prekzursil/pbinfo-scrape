import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { ArchiveCrawler } from '../../src/crawl/archive-crawler.js';
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

function createWorkspace(
  overrides?: {
    crawl?: {
      userHandle?: string;
    };
  },
) {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-crawl-'));
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

describe('ArchiveCrawler', () => {
  test('archives a page and enqueues same-host links and assets', async () => {
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <html>
            <head>
              <link rel="stylesheet" href="/site.css">
            </head>
            <body>
              <a href="/probleme">Probleme</a>
              <a href="https://example.com/outside">Outside</a>
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

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const queue = new CrawlQueue(workspace.queuePath);
    queue.enqueueMany([
      {
        key: `page:${baseUrl}/`,
        url: `${baseUrl}/`,
        kind: 'public-page',
      },
    ]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
    });

    await crawler.processNext(new Date('2026-03-10T00:00:00.000Z'));

    const snapshot = queue.getSnapshot();
    expect(snapshot.completed).toBe(1);
    expect(snapshot.pending).toBe(2);
    expect(snapshot.items.map((item) => item.key)).toEqual([
      `page:${baseUrl}/`,
      `page:${baseUrl}/probleme`,
      `asset:${baseUrl}/site.css`,
    ]);

    const archivedHtml = readFileSync(
      join(workspace.snapshot.rawPagesRoot, 'page-http-127-0-0-1-root.html'),
      'utf8',
    );
    expect(archivedHtml).toContain('<a href="/probleme">Probleme</a>');
  }, 20_000);

  test('backs off throttled solution pages instead of completing them', async () => {
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(`
        <div class="alert alert-warning text-center my-5">
          Resursă indisponibilă temporar. Încercați din nou peste câteva secunde.
        </div>
      `);
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
    const queue = new CrawlQueue(workspace.queuePath);
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
      retryDelayMs: 30_000,
    });

    await crawler.processNext(new Date('2026-03-10T00:00:00.000Z'));

    const snapshot = queue.getSnapshot();
    expect(snapshot.completed).toBe(0);
    expect(snapshot.pending).toBe(1);
    expect(snapshot.items[0]?.lastError).toBe('temporarily unavailable');
    expect(snapshot.items[0]?.visibleAt).toBe('2026-03-10T00:00:30.000Z');
  });

  test('recovers from a malformed raw-pages manifest while archiving a page', async () => {
    const workspace = createWorkspace();
    mkdirSync(workspace.snapshot.rawPagesRoot, { recursive: true });
    writeFileSync(workspace.snapshot.rawPagesManifestPath, '{', 'utf8');

    const server = createServer((request, response) => {
      if (request.url === '/probleme/3171/waterreserve') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><h1><span>#3171</span> <a href="/probleme/3171/waterreserve">WaterReserve</a></h1></body></html>');
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
    const queue = new CrawlQueue(workspace.queuePath);
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
    });

    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);

    const manifest = JSON.parse(readFileSync(workspace.snapshot.rawPagesManifestPath, 'utf8')) as Record<string, string>;
    expect(manifest[url]).toMatch(/page-http-127-0-0-1-probleme-3171-waterreserve\.html$/);
  });

  test('archives same-host asset payloads under snapshot raw-assets', async () => {
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
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

    const url = `http://127.0.0.1:${address.port}/site.css`;
    const queue = new CrawlQueue(workspace.queuePath);
    queue.enqueueMany([
      {
        key: `asset:${url}`,
        url,
        kind: 'public-asset',
      },
    ]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
    });

    await crawler.processNext(new Date('2026-03-10T00:00:00.000Z'));

    const archivedCss = readFileSync(
      join(workspace.snapshot.rawAssetsRoot, 'asset-http-127-0-0-1-site-css.css'),
      'utf8',
    );
    expect(archivedCss).toContain('body { color: red; }');
  });

  test('keeps only meaningful same-host follow-ups and user-scoped account routes', async () => {
    const workspace = createWorkspace({
      crawl: {
        userHandle: 'Prekzursil',
      },
    });
    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <html>
            <body>
              <a href="/probleme/3171/waterreserve">Problem</a>
              <a href="/solutii/problema/3171/waterreserve">Official solution</a>
              <a href="/probleme-categorii/9">Grade 9</a>
              <a href="/probleme/eticheta/2/vectori">Vectors tag</a>
              <a href="/profil/Prekzursil">My profile</a>
              <a href="/profil/OtherUser">Other profile</a>
              <a href="/solutii/user/Prekzursil">My solutions</a>
              <a href="/solutii/user/OtherUser">Other solutions</a>
              <a href="/detalii-evaluare/63332367">Direct evaluation</a>
              <a href="/?pagina=itemi-evaluare&id=63332367">Evaluation shell</a>
              <a href="/?pagina=probleme-lista&tag=2&clasa=9">Problem list</a>
              <a href="/?clasa=9&pagina=probleme-lista&tag=2">Problem list duplicate</a>
              <a href="/?pagina=probleme-lista&id_concurs=150">Contest problem list</a>
              <a href="/articole/123/editorial">Article</a>
              <a href="/articole/recomandate?problem=3171">Recommended articles</a>
              <a href="/?b=2&a=1">Noncanonical query</a>
              <a href="/?pagina=processing&id=123">Processing page</a>
              <a href="/?pagina=conversatii&partener=OtherUser">Conversation page</a>
              <a href="/editare-cont">Edit account</a>
              <a href="resurse/9dc152/p-1100/cub2.png">Relative asset link</a>
              <a href="/resurse/9dc152/examene/2026/model.pdf">Exam PDF</a>
              <img src="/resurse/9dc152/articole/cpp/quicksort.png">
              <img src="/resurse/ajutor/help.png">
              <img src="/php/gravatar.php?hash=abc&gsize=190">
              <img src="/resurse/probleme/851-900/depou.png">
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

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const queue = new CrawlQueue(workspace.queuePath);
    queue.enqueueMany([
      {
        key: `page:${baseUrl}/`,
        url: `${baseUrl}/`,
        kind: 'public-page',
      },
    ]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
    });

    await crawler.processNext(new Date('2026-03-10T00:00:00.000Z'));

    const queuedKeys = queue
      .getSnapshot()
      .items.map((item) => item.key)
      .sort();

    expect(queuedKeys).toContain(`page:${baseUrl}/probleme/3171/waterreserve`);
    expect(queuedKeys).toContain(`page:${baseUrl}/solutii/problema/3171/waterreserve`);
    expect(queuedKeys).toContain(`page:${baseUrl}/probleme-categorii/9`);
    expect(queuedKeys).toContain(`page:${baseUrl}/probleme/eticheta/2/vectori`);
    expect(queuedKeys).toContain(`page:${baseUrl}/profil/Prekzursil`);
    expect(queuedKeys).toContain(`page:${baseUrl}/solutii/user/Prekzursil`);
    expect(queuedKeys).toContain(`page:${baseUrl}/?clasa=9&pagina=probleme-lista&tag=2`);

    expect(queuedKeys).not.toContain(`page:${baseUrl}/profil/OtherUser`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/solutii/user/OtherUser`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/detalii-evaluare/63332367`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/?pagina=itemi-evaluare&id=63332367`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/articole/123/editorial`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/articole/recomandate?problem=3171`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/?a=1&b=2`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/?id_concurs=150&pagina=probleme-lista`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/?id=123&pagina=processing`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/?pagina=conversatii&partener=OtherUser`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/editare-cont`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/probleme/3171/resurse/9dc152/p-1100/cub2.png`);
    expect(queuedKeys).not.toContain(`page:${baseUrl}/resurse/9dc152/examene/2026/model.pdf`);
    expect(queuedKeys).not.toContain(`asset:${baseUrl}/resurse/9dc152/articole/cpp/quicksort.png`);
    expect(queuedKeys).not.toContain(`asset:${baseUrl}/resurse/ajutor/help.png`);
    expect(queuedKeys).toContain(`asset:${baseUrl}/resurse/probleme/851-900/depou.png`);
    expect(queuedKeys).not.toContain(`asset:${baseUrl}/php/gravatar.php?gsize=190&hash=abc`);
    expect(
      queuedKeys.filter(
        (key) => key === `page:${baseUrl}/?clasa=9&pagina=probleme-lista&tag=2`,
      ),
    ).toHaveLength(1);
  });

  test('persists normalized problem and page records in the snapshot archive', async () => {
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
      if (request.url === '/probleme/3171/waterreserve') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <html>
            <head><link rel="stylesheet" href="/static/site.css"></head>
            <body>
              <table>
                <tr>
                  <th>Clasa</th>
                  <th>Limită timp</th>
                  <th>Limită memorie</th>
                  <th>Sursa problemei</th>
                  <th>Autor</th>
                </tr>
                <tr>
                  <td>9</td>
                  <td>0.2 secunde</td>
                  <td>64 MB / 64 MB</td>
                  <td>Admitere UNIBUC 2019</td>
                  <td>Mirela Mlisan</td>
                </tr>
              </table>
              <h1><span>#3171</span> <a href="/probleme/3171/waterreserve">WaterReserve</a></h1>
              <div>
                <ul>
                  <li><a href="/?pagina=probleme-lista&clasa=9">Clasa a 9-a</a></li>
                  <li><a href="/?pagina=probleme-lista&tag=2">Tablouri unidimensionale (vectori)</a></li>
                </ul>
              </div>
              <article id="enunt">
                <h1>Cerința</h1>
                <p>Se cere să determinați cel mai mare număr de orașe.</p>
              </article>
            </body>
          </html>
        `);
        return;
      }

      if (request.url === '/static/site.css') {
        response.setHeader('Content-Type', 'text/css');
        response.end('body { color: green; }');
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
    const queue = new CrawlQueue(workspace.queuePath);
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
    });

    await crawler.processNext(new Date('2026-03-10T00:00:00.000Z'));

    const problemRecord = JSON.parse(
      readFileSync(
        join(workspace.snapshot.normalizedRoot, 'problems', 'problem-3171.json'),
        'utf8',
      ),
    );
    const pageRecord = JSON.parse(
      readFileSync(
        join(workspace.snapshot.normalizedRoot, 'pages', 'page-http-127-0-0-1-probleme-3171-waterreserve.json'),
        'utf8',
      ),
    );

    expect(problemRecord.name).toBe('WaterReserve');
    expect(problemRecord.metadata['sursa problemei']).toBe('Admitere UNIBUC 2019');
    expect(pageRecord.snapshotId).toBe('snapshot-20260310T000000Z');
    expect(
      readFileSync(
        join(
          workspace.snapshot.rawPagesRoot,
          'page-http-127-0-0-1-probleme-3171-waterreserve.html',
        ),
        'utf8',
      ),
    ).toContain('WaterReserve');
  });

  test('recovers from a corrupted raw-pages manifest while normalizing a page', async () => {
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
      if (request.url === '/probleme/4000/demo') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <html>
            <body>
              <h1><span>#4000</span> <a href="/probleme/4000/demo">Demo</a></h1>
              <article id="enunt"><h1>Cerința</h1><p>Demo statement.</p></article>
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

    writeFileSync(workspace.snapshot.rawPagesManifestPath, '{', 'utf8');

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    const url = `http://127.0.0.1:${address.port}/probleme/4000/demo`;
    const queue = new CrawlQueue(workspace.queuePath);
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
    });

    await expect(
      crawler.processNext(new Date('2026-03-10T00:00:00.000Z')),
    ).resolves.toBe(true);

    const pageRecord = JSON.parse(
      readFileSync(
        join(
          workspace.snapshot.normalizedRoot,
          'pages',
          'page-http-127-0-0-1-probleme-4000-demo.json',
        ),
        'utf8',
      ),
    );

    expect(pageRecord.bodyPath).toBe('raw-pages/page-http-127-0-0-1-probleme-4000-demo.html');
    expect(queue.getSnapshot().completed).toBe(1);
  });

  test('records evaluation parse failures without aborting the crawl', async () => {
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
      if (request.url === '/detalii-evaluare/63571984') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <html>
            <head><title>Detalii evaluare: ~63571984</title></head>
            <body>
              <div id="div-continut-pagina"></div>
              <input type="hidden" name="GET_id" value="63571984">
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

    const url = `http://127.0.0.1:${address.port}/detalii-evaluare/63571984`;
    const queue = new CrawlQueue(workspace.queuePath);
    queue.enqueueMany([
      {
        key: `evaluation:${url}`,
        url,
        kind: 'evaluation-detail',
      },
    ]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
    });

    await expect(
      crawler.processNext(new Date('2026-03-10T00:00:00.000Z')),
    ).resolves.toBe(true);

    const failureRecord = JSON.parse(
      readFileSync(
        join(
          workspace.snapshot.normalizedRoot,
          'evaluation-errors',
          'evaluation-63571984.json',
        ),
        'utf8',
      ),
    );
    const queueSnapshot = queue.getSnapshot();

    expect(failureRecord).toMatchObject({
      evaluationId: 63571984,
      sourceUrl: url,
    });
    expect(queueSnapshot.completed).toBe(1);
  });

  test('discovers evaluation follow-ups only from the configured user solution page', async () => {
    const workspace = createWorkspace({
      crawl: {
        userHandle: 'Prekzursil',
      },
    });
    const server = createServer((request, response) => {
      if (request.url === '/solutii/user/Prekzursil') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <html>
            <body>
              <div class="bold mb-3">1 soluții</div>
              <a href="/profil/Prekzursil">Prekzursil</a>
              <a href="/probleme/3171/waterreserve">WaterReserve</a>
              <a href="/detalii-evaluare/63332367">100 puncte</a>
            </body>
          </html>
        `);
        return;
      }

      if (request.url === '/solutii/user/OtherUser') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <html>
            <body>
              <div class="bold mb-3">1 soluții</div>
              <a href="/profil/OtherUser">OtherUser</a>
              <a href="/probleme/3171/waterreserve">WaterReserve</a>
              <a href="/detalii-evaluare/70000000">100 puncte</a>
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

    const baseUrl = `http://127.0.0.1:${address.port}`;

    const ownQueue = new CrawlQueue(join(workspace.root, '.local', 'own-queue.sqlite'));
    ownQueue.enqueueMany([
      {
        key: `page:${baseUrl}/solutii/user/Prekzursil`,
        url: `${baseUrl}/solutii/user/Prekzursil`,
        kind: 'user-solutions',
      },
    ]);
    const ownCrawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue: ownQueue,
    });
    await ownCrawler.processNext(new Date('2026-03-10T00:00:00.000Z'));
    expect(ownQueue.getSnapshot().items.map((item) => item.key)).toContain('evaluation:63332367');

    const otherQueue = new CrawlQueue(join(workspace.root, '.local', 'other-queue.sqlite'));
    otherQueue.enqueueMany([
      {
        key: `page:${baseUrl}/solutii/user/OtherUser`,
        url: `${baseUrl}/solutii/user/OtherUser`,
        kind: 'user-solutions',
      },
    ]);
    const otherCrawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue: otherQueue,
    });
    await otherCrawler.processNext(new Date('2026-03-10T00:00:00.000Z'));
    expect(otherQueue.getSnapshot().items.map((item) => item.key)).not.toContain(
      'evaluation:70000000',
    );
  });
});
