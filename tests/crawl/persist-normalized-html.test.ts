import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { prepareSnapshot, type SnapshotLayout } from '../../src/archive/storage.js';
import { loadLocalConfig, type LoadedLocalConfig } from '../../src/config/local-config.js';
import { persistNormalizedSnapshotHtml } from '../../src/crawl/archive-crawler.js';
import type { CrawlQueueInput } from '../../src/types/crawl.js';

const tempDirs: string[] = [];
let config: LoadedLocalConfig;
let snapshot: SnapshotLayout;

beforeEach(() => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-persist-'));
  tempDirs.push(workspaceRoot);
  config = loadLocalConfig(workspaceRoot);
  // Inject a configured handle for user-solutions normalization.
  config = { ...config, crawl: { ...config.crawl, userHandle: 'Prekzursil' } };
  snapshot = prepareSnapshot(config, {
    snapshotId: 'persist-snapshot',
    scope: 'all',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function persist(item: CrawlQueueInput, html: string, normalizedFromBrowser = false): void {
  persistNormalizedSnapshotHtml({
    config,
    snapshot,
    item,
    html,
    httpStatus: 200,
    contentType: 'text/html',
    fetchedAt: '2026-03-10T00:00:00.000Z',
    normalizedFromBrowser,
  });
}

function readNormalized(...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(snapshot.normalizedRoot, ...segments), 'utf8'));
}

const problemKey = 'problem-statement:https://www.pbinfo.ro/probleme/3171/waterreserve';
const solutionHtml = `<div>
  <a href="#cpp-tab">C++</a>
  <div id="cpp-tab"><pre>int main(){return 0;}</pre></div>
</div>`;
const evaluationHtml = `
<div id="rezumat">
  <a href="/probleme/4967/collatz1">Collatz1</a>
  <a href="/profil/Prekzursil">Prekzursil</a>
  <table class="table">
    <tr><th>Limbaj</th><td>C++</td></tr>
    <tr><th>Punctaj</th><td>100</td></tr>
  </table>
</div>
<textarea>int main(){return 0;}</textarea>
<div id="detalii">
  <table class="table table-bordered">
    <tr><th>Test</th><th>Mesaj evaluare</th><th>Scor</th></tr>
    <tr><td>1</td><td>exemplu OK.</td><td>10</td></tr>
  </table>
</div>`;

describe('persistNormalizedSnapshotHtml', () => {
  test('persists a public problem page record', () => {
    persist(
      { key: 'page:x', url: 'https://www.pbinfo.ro/probleme/3171/waterreserve', kind: 'public-page' },
      '<html><body><h1><a href="/probleme/3171/waterreserve">WaterReserve</a></h1></body></html>',
    );
    expect((readNormalized('problems', 'problem-3171.json') as { name: string }).name).toBe('WaterReserve');
  });

  test('preserves existing problem fields when a public page record is re-persisted', () => {
    // Seed a problem record that already carries editorial, official solutions/source ids and
    // visible tests, so the later public-page merge takes the `current?.X ?? record.X` keep-existing
    // branches instead of the first-write defaults.
    persist({ key: problemKey, url: 'https://www.pbinfo.ro/x', kind: 'problem-solution' }, solutionHtml);
    persist(
      { key: 'problem-tests:https://www.pbinfo.ro/probleme/3171/waterreserve', url: 'https://www.pbinfo.ro/t', kind: 'problem-tests' },
      `<h3>Test 1</h3><p>Intrare</p><pre>10 20</pre><p>Ieșire</p><pre>30</pre>`,
    );
    const before = readNormalized('problems', 'problem-3171.json') as { editorial: unknown };
    expect(before.editorial).toBeDefined();

    persist(
      { key: 'page:x', url: 'https://www.pbinfo.ro/probleme/3171/waterreserve', kind: 'public-page' },
      '<html><body><h1><a href="/probleme/3171/waterreserve">WaterReserve</a></h1></body></html>',
    );
    const problem = readNormalized('problems', 'problem-3171.json') as {
      name: string;
      editorial: unknown;
      officialSolutions: Record<string, unknown>;
      officialSourceIds: Record<string, unknown>;
      visibleTests: unknown[];
      editorialAvailability: string;
    };
    expect(problem.name).toBe('WaterReserve');
    expect(problem.editorial).toBeDefined();
    expect(Object.keys(problem.officialSolutions).length).toBeGreaterThan(0);
    expect(Object.keys(problem.officialSourceIds).length).toBeGreaterThan(0);
    expect(problem.visibleTests.length).toBeGreaterThan(0);
    expect(problem.editorialAvailability).toBe('visible');
  });

  test('persists statement examples', () => {
    persist(
      { key: problemKey, url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-enunt.php?id=3171', kind: 'problem-statement' },
      `<article id="enunt"><h1>Cerința</h1><p>Demo.</p><h1>Exemplu</h1><p>Date de intrare</p><pre>5 7</pre><p>Date de ieșire</p><pre>12</pre></article>`,
    );
    expect((readNormalized('tests', 'problem-3171.json') as { examples: unknown[] }).examples.length).toBe(1);
  });

  test('persists official sources from a solution fragment and a browser fallback', () => {
    persist({ key: problemKey, url: 'https://www.pbinfo.ro/x', kind: 'problem-solution' }, solutionHtml);
    expect(existsSync(join(snapshot.normalizedRoot, 'sources', 'official-3171-cpp.json'))).toBe(true);
    // A browser-fallback re-run merges language source ids.
    persist({ key: problemKey, url: 'https://www.pbinfo.ro/x', kind: 'problem-solution' }, solutionHtml, true);
    const problem = readNormalized('problems', 'problem-3171.json') as { officialSourceIds: Record<string, string[]> };
    expect(problem.officialSourceIds.cpp?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  test('persists visible tests', () => {
    persist(
      { key: 'problem-tests:https://www.pbinfo.ro/probleme/3171/waterreserve', url: 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-teste.php?id=3171', kind: 'problem-tests' },
      `<h3>Test 1</h3><p>Intrare</p><pre>10 20</pre><p>Ieșire</p><pre>30</pre>`,
    );
    expect((readNormalized('tests', 'problem-3171.json') as { visible: unknown[] }).visible.length).toBe(1);
  });

  test('persists a user evaluation and its observed tests', () => {
    persist({ key: 'evaluation:1', url: 'https://www.pbinfo.ro/detalii-evaluare/123', kind: 'evaluation-detail' }, evaluationHtml);
    expect(existsSync(join(snapshot.normalizedRoot, 'evaluations', 'evaluation-123.json'))).toBe(true);
    expect(existsSync(join(snapshot.normalizedRoot, 'sources', 'evaluation-123.json'))).toBe(true);
    expect((readNormalized('tests', 'problem-4967.json') as { evaluationObserved: unknown[] }).evaluationObserved.length).toBe(1);
  });

  test('persists an official evaluation source', () => {
    persist({ key: 'official-evaluation:1', url: 'https://www.pbinfo.ro/detalii-evaluare/777', kind: 'official-evaluation-detail' }, evaluationHtml);
    expect(existsSync(join(snapshot.normalizedRoot, 'sources', 'official-4967-cpp-777.json'))).toBe(true);
  });

  test('records evaluation parse failures without throwing', () => {
    persist({ key: 'evaluation:9', url: 'https://www.pbinfo.ro/detalii-evaluare/999', kind: 'evaluation-detail' }, '<div>nothing</div>');
    expect(existsSync(join(snapshot.normalizedRoot, 'evaluation-errors', 'evaluation-999.json'))).toBe(true);
  });

  test('persists a user-solutions listing record', () => {
    persist(
      { key: 'user-solutions:1', url: 'https://www.pbinfo.ro/solutii/user/Prekzursil', kind: 'user-solutions' },
      `<div class="bold mb-3">1 soluții respectă criteriile.</div>
       <table><tr>
         <td><a href="/profil/Prekzursil">Andrei (Prekzursil)</a></td>
         <td><a href="/probleme/1/sum">sum</a></td>
         <td><a href="/detalii-evaluare/70000001">Evaluare finalizată</a></td>
       </tr></table>`,
    );
    const record = readNormalized('user-solutions', 'user-prekzursil.json') as { entries: unknown[] };
    expect(record.entries.length).toBeGreaterThanOrEqual(1);
  });

  test('persists a category page record', () => {
    persist(
      { key: 'page:cat', url: 'https://www.pbinfo.ro/probleme-categorii/9', kind: 'public-page' },
      `<a href="/probleme-categorii/9/tablouri">Tablouri</a>
       <a href="/?pagina=itemi-evaluare-lista&tag=9">items</a>`,
    );
    expect(existsSync(join(snapshot.normalizedRoot, 'categories', 'grade-9.json'))).toBe(true);
  });

  test('merges repeated records that already exist in the archive', () => {
    const tests = `<h3>Test 1</h3><p>Intrare</p><pre>10 20</pre><p>Ieșire</p><pre>30</pre>`;
    // A visible solution marks the problem visible; a later tests fragment keeps that visibility.
    persist({ key: problemKey, url: 'https://www.pbinfo.ro/x', kind: 'problem-solution' }, solutionHtml);
    persist({ key: 'problem-tests:https://www.pbinfo.ro/probleme/3171/waterreserve', url: 'https://www.pbinfo.ro/t', kind: 'problem-tests' }, tests);
    expect((readNormalized('problems', 'problem-3171.json') as { editorialAvailability: string }).editorialAvailability).toBe('visible');

    // Persisting the same kinds twice exercises the merge-with-existing-record branches.
    const statement = `<article id="enunt"><h1>Cerința</h1><p>D.</p><h1>Exemplu</h1><p>Date de intrare</p><pre>1</pre><p>Date de ieșire</p><pre>2</pre></article>`;
    persist({ key: problemKey, url: 'https://www.pbinfo.ro/e', kind: 'problem-statement' }, statement);
    persist({ key: problemKey, url: 'https://www.pbinfo.ro/e', kind: 'problem-statement' }, statement);
    persist({ key: 'problem-tests:https://www.pbinfo.ro/probleme/3171/waterreserve', url: 'https://www.pbinfo.ro/t', kind: 'problem-tests' }, tests);
    persist({ key: 'evaluation:1', url: 'https://www.pbinfo.ro/detalii-evaluare/123', kind: 'evaluation-detail' }, evaluationHtml);
    persist({ key: 'evaluation:1', url: 'https://www.pbinfo.ro/detalii-evaluare/123', kind: 'evaluation-detail' }, evaluationHtml);
    persist({ key: 'official:1', url: 'https://www.pbinfo.ro/detalii-evaluare/123', kind: 'official-evaluation-detail' }, evaluationHtml);
    persist({ key: 'official:1', url: 'https://www.pbinfo.ro/detalii-evaluare/123', kind: 'official-evaluation-detail' }, evaluationHtml);

    const usHtml = `<div class="bold mb-3">1 soluții respectă criteriile.</div>
      <table><tr><td><a href="/profil/Prekzursil">Andrei (Prekzursil)</a></td><td><a href="/probleme/1/sum">sum</a></td><td><a href="/detalii-evaluare/70000001">Evaluare finalizată</a></td></tr></table>
      <script>let tmp = Paginare(1, 0, 1);</script>`;
    persist({ key: 'us:1', url: 'https://www.pbinfo.ro/solutii/user/Prekzursil', kind: 'user-solutions' }, usHtml);
    persist({ key: 'us:1', url: 'https://www.pbinfo.ro/solutii/user/Prekzursil', kind: 'user-solutions' }, usHtml);
    const us = readNormalized('user-solutions', 'user-prekzursil.json') as { entries: unknown[] };
    expect(us.entries.length).toBe(1);
  });

  test('tolerates empty example and visible-test io and missing pagination', () => {
    persist(
      { key: problemKey, url: 'https://www.pbinfo.ro/e', kind: 'problem-statement' },
      `<article id="enunt"><h1>Cerința</h1><p>D.</p><h1>Exemplu</h1>
        <p>Date de intrare</p><pre></pre><p>Date de ieșire</p><pre>5</pre>
        <p>Date de intrare</p><pre>3</pre><p>Date de ieșire</p><pre></pre></article>`,
    );
    persist(
      { key: 'problem-tests:https://www.pbinfo.ro/probleme/3171/waterreserve', url: 'https://www.pbinfo.ro/t', kind: 'problem-tests' },
      `<h3>Test 1</h3><p>Intrare</p><pre></pre><p>Ieșire</p><pre>5</pre>
       <h3>Test 2</h3><p>Intrare</p><pre>9</pre><p>Ieșire</p><pre></pre>`,
    );
    // user-solutions with pagination, then a second page without pagination metadata.
    const paginated = `<div class="bold mb-3">1 soluții respectă criteriile.</div>
      <table><tr><td><a href="/profil/Prekzursil">A (Prekzursil)</a></td><td><a href="/probleme/1/sum">sum</a></td><td><a href="/detalii-evaluare/1">Evaluare finalizată</a></td></tr></table>
      <script>let tmp = Paginare(100, 0, 1);</script>`;
    const unpaginated = `<div class="bold mb-3">1 soluții respectă criteriile.</div>
      <table><tr><td><a href="/profil/Prekzursil">A (Prekzursil)</a></td><td><a href="/probleme/1/sum">sum</a></td><td><a href="/detalii-evaluare/2">Evaluare finalizată</a></td></tr></table>`;
    persist({ key: 'us:2', url: 'https://www.pbinfo.ro/solutii/user/Prekzursil', kind: 'user-solutions' }, paginated);
    persist({ key: 'us:2', url: 'https://www.pbinfo.ro/solutii/user/Prekzursil', kind: 'user-solutions' }, unpaginated);
    const us = readNormalized('user-solutions', 'user-prekzursil.json') as { pageSize?: number };
    expect(us.pageSize).toBeDefined();
  });

  test('records a mirror route with a query string', () => {
    persist(
      { key: 'page:q', url: 'https://www.pbinfo.ro/probleme?pagina=probleme-lista&clasa=9', kind: 'public-page' },
      '<html><body>list</body></html>',
    );
    expect(readdirSync(join(snapshot.normalizedRoot, 'routes')).length).toBeGreaterThan(0);
  });

  test('resolves the editorial artifact path when the raw page exists', () => {
    writeFileSync(join(snapshot.rawPagesRoot, 'page-https-www-pbinfo-ro-x.html'), solutionHtml, 'utf8');
    persist({ key: problemKey, url: 'https://www.pbinfo.ro/x', kind: 'problem-solution' }, solutionHtml);
    const problem = readNormalized('problems', 'problem-3171.json') as { editorial: { artifactPath?: string } };
    expect(problem.editorial.artifactPath).toBe('raw-pages/page-https-www-pbinfo-ro-x.html');
  });
});
