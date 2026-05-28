import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { runNormalizeSnapshotWorkflow } from '../../src/workflows/normalize-workflow.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('runNormalizeSnapshotWorkflow', () => {
  test('rebuilds normalized evaluations and sources from archived raw pages without refetching', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-normalize-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'normalize-snapshot',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'evaluation.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/detalii-evaluare/63332367',
        kind: 'evaluation-detail',
        httpStatus: 200,
        contentType: 'text/html',
        bodyPath: 'raw-pages/evaluation-63332367.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }),
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawPagesRoot, 'evaluation-63332367.html'),
      `
        <div id="detalii">
          <table class="table">
            <tr>
              <th>Problema</th><td><a href="/probleme/3716/crossword">Crossword</a></td>
              <th>Fișier</th><td>crossword.c</td>
            </tr>
            <tr>
              <th>Utilizator</th><td><a href="/profil/Prekzursil">Prekzursil</a></td>
              <th>Scor/rezultat</th><td>100 puncte</td>
            </tr>
            <tr>
              <th>Limita timp</th><td>0.1 secunde</td>
              <th>Limita memorie</th><td>64 MB</td>
            </tr>
          </table>
        </div>
        <div id="evaluare">
          <pre>warning: ignored return value</pre>
          <table class="table">
            <tr>
              <th>Test</th>
              <th>Timp</th>
              <th>Mesaj evaluare</th>
              <th>Scor posibil</th>
              <th>Scor obținut</th>
              <th></th>
            </tr>
            <tr>
              <td>1</td>
              <td>0.002 secunde</td>
              <td>OK.</td>
              <td>5</td>
              <td>5</td>
              <td>Exemplu</td>
            </tr>
          </table>
        </div>
        <textarea>
        #include <stdio.h>
        int main(void) { return 0; }
        </textarea>
      `,
      'utf8',
    );
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({
        'https://www.pbinfo.ro/detalii-evaluare/63332367': 'evaluation-63332367.html',
      }),
      'utf8',
    );

    const result = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId);
    const evaluation = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'evaluations', 'evaluation-63332367.json'),
        'utf8',
      ),
    );
    const source = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'sources', 'evaluation-63332367.json'), 'utf8'),
    );
    const testsRecord = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'tests', 'problem-3716.json'), 'utf8'),
    );

    expect(result.pagesNormalized).toBe(1);
    expect(evaluation).toMatchObject({
      evaluationId: 63332367,
      language: 'c',
      score: 100,
      compileLog: 'warning: ignored return value',
      tests: [
        expect.objectContaining({
          index: 1,
          details: 'Exemplu',
        }),
      ],
    });
    expect(source).toMatchObject({
      sourceId: 'evaluation-63332367',
      kind: 'user-evaluation',
      problemId: 3716,
      language: 'c',
      sourceAvailable: true,
    });
    expect(testsRecord).toMatchObject({
      problemId: 3716,
      evaluationObserved: [
        expect.objectContaining({
          kind: 'evaluationObserved',
          evaluationId: 63332367,
          index: 1,
          details: 'Exemplu',
        }),
      ],
    });
  });

  test('skips page records without raw bodies, missing html files, and a missing pages directory', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-normalize-skip-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'normalize-skip',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    // No `pages` directory yet -> loadPageRecords swallows the readdir error.
    const emptyRun = await runNormalizeSnapshotWorkflow(workspaceRoot, 'normalize-skip');
    expect(emptyRun.pagesNormalized).toBe(0);

    mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'no-body.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/no-body',
        kind: 'public-page',
        httpStatus: 200,
        contentType: 'text/html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'missing-html.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/missing',
        kind: 'public-page',
        httpStatus: 200,
        contentType: 'text/html',
        bodyPath: 'raw-pages/does-not-exist.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }),
      'utf8',
    );

    const skippedRun = await runNormalizeSnapshotWorkflow(workspaceRoot, 'normalize-skip');
    expect(skippedRun.pagesNormalized).toBe(0);
  });

  test('records evaluation parse errors instead of crashing on access-denied evaluation pages', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-normalize-error-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'normalize-error-snapshot',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'evaluation-403.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        url: 'https://www.pbinfo.ro/detalii-evaluare/63571975',
        kind: 'evaluation-detail',
        httpStatus: 403,
        contentType: 'text/html',
        bodyPath: 'raw-pages/evaluation-63571975.html',
        fetchedAt: '2026-03-10T00:00:00.000Z',
      }),
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawPagesRoot, 'evaluation-63571975.html'),
      '<html><body><h1>403</h1><h2>Acces Interzis</h2></body></html>',
      'utf8',
    );
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({
        'https://www.pbinfo.ro/detalii-evaluare/63571975': 'evaluation-63571975.html',
      }),
      'utf8',
    );

    const result = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId);
    const errorRecord = JSON.parse(
      readFileSync(
        join(snapshot.normalizedRoot, 'evaluation-errors', 'evaluation-63571975.json'),
        'utf8',
      ),
    );

    expect(result.pagesNormalized).toBe(1);
    expect(errorRecord).toMatchObject({
      evaluationId: 63571975,
      sourceUrl: 'https://www.pbinfo.ro/detalii-evaluare/63571975',
      error: expect.stringMatching(/Could not find problem link/i),
    });
  });
});
