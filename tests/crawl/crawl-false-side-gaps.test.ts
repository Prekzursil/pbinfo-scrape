import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { ArchiveCrawler } from '../../src/crawl/archive-crawler.js';
import { CrawlQueue } from '../../src/crawl/crawl-queue.js';

const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-crawl-gaps-'));
  mkdirSync(join(root, '.local'), { recursive: true });
  tempDirs.push(root);
  const config = loadLocalConfig(root);
  const snapshot = prepareSnapshot(config, {
    snapshotId: 'GAPS',
    scope: 'all',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });
  return { root, config, snapshot };
}

describe('manifest write-lock chaining', () => {
  test('a rejected prior write is swallowed and a superseded lock entry is left alone', async () => {
    const { config, snapshot } = createWorkspace();
    const queue = new CrawlQueue(join(config.paths.localRoot, 'crawl-queues', 'gaps.sqlite'));
    const crawler = new ArchiveCrawler({ config, snapshot, queue });

    // White-box: exercise the private serialized writer directly so both the
    // swallow of a rejected prior promise and the superseded-lock cleanup run
    // deterministically (no scheduler luck needed).
    const writer = crawler as unknown as {
      writeManifestEntry: (manifestPath: string, url: string, fileName: string) => Promise<void>;
    };
    const manifestPath = join(snapshot.rawPagesRoot, 'manifest-race.json');
    // A directory at the manifest path makes both writes fail (EISDIR), so the
    // first entry rejects and the second entry's `.catch(() => undefined)`
    // absorbs that rejection before attempting its own (also failing) write.
    mkdirSync(manifestPath, { recursive: true });

    const first = writer.writeManifestEntry(manifestPath, 'https://x/first', 'first.html');
    // Chained before `first` settles: when `first` runs its finally, the lock
    // map already holds the second entry, so the first cleanup is a no-op.
    const second = writer.writeManifestEntry(manifestPath, 'https://x/second', 'second.html');

    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
  });
});

describe('official source-list harvest ordering', () => {
  test('sorts multiple qualifying evaluation ids in the merged harvest record', async () => {
    const workspace = createWorkspace();
    const server = createServer((request, response) => {
      if (request.url === '/solutii/user/pbinfo/problema/3171/waterreserve') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <table class="table">
            <tbody>
              <tr>
                <td><a href="/profil/pbinfo">pbinfo</a></td>
                <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
                <td><a href="/detalii-evaluare/70000009">Evaluare finalizată</a></td>
                <td>100</td>
              </tr>
              <tr>
                <td><a href="/profil/pbinfo">pbinfo</a></td>
                <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
                <td><a href="/detalii-evaluare/70000005">Evaluare finalizată</a></td>
                <td>100</td>
              </tr>
              <tr>
                <td><a href="/profil/pbinfo">pbinfo</a></td>
                <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
                <td><a href="/detalii-evaluare/70000007">Evaluare finalizată</a></td>
                <td>30 puncte</td>
              </tr>
            </tbody>
          </table>
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
    const url = `http://127.0.0.1:${address.port}/solutii/user/pbinfo/problema/3171/waterreserve`;
    const queue = new CrawlQueue(join(workspace.config.paths.localRoot, 'crawl-queues', 'harvest-order.sqlite'));
    queue.enqueueMany([{ key: `official-source-list:${url}`, url, kind: 'official-source-list' }]);

    const crawler = new ArchiveCrawler({
      config: workspace.config,
      snapshot: workspace.snapshot,
      queue,
    });
    await expect(crawler.processNext(new Date('2026-03-10T00:00:00.000Z'))).resolves.toBe(true);

    const merged = JSON.parse(
      readFileSync(join(workspace.snapshot.normalizedRoot, 'problems', 'problem-3171.json'), 'utf8'),
    ) as { officialSourceHarvest?: { qualifyingEvaluationIds?: number[] } };
    expect(merged.officialSourceHarvest?.qualifyingEvaluationIds).toEqual([70000005, 70000009]);
  });
});
