import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.resetModules();

  const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
  for (const dir of tempDirs.splice(0)) {
    actualFs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('runNormalizeSnapshotWorkflow retry handling', () => {
  test('retries retryable normalized-directory reset errors before failing', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const workspaceRoot = actualFs.mkdtempSync(join(tmpdir(), 'pbinfo-normalize-retry-'));
    tempDirs.push(workspaceRoot);

    vi.resetModules();

    let injectedFailure = false;
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');

      return {
        ...actual,
        rmSync(target: Parameters<typeof actual.rmSync>[0], options?: Parameters<typeof actual.rmSync>[1]) {
          if (
            !injectedFailure
            && String(target).endsWith(`${sep}normalized${sep}problems${sep}stale.json`)
          ) {
            injectedFailure = true;
            const error = new Error('Directory not empty') as NodeJS.ErrnoException;
            error.code = 'ENOTEMPTY';
            throw error;
          }

          return actual.rmSync(target, options);
        },
      };
    });

    const { prepareSnapshot } = await import('../../src/archive/storage.js');
    const { loadLocalConfig } = await import('../../src/config/local-config.js');
    const { runNormalizeSnapshotWorkflow } = await import('../../src/workflows/normalize-workflow.js');

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'normalize-retry-snapshot',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    actualFs.mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    actualFs.mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    actualFs.writeFileSync(join(snapshot.normalizedRoot, 'problems', 'stale.json'), '{}', 'utf8');

    const result = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId);

    expect(injectedFailure).toBe(true);
    expect(result.pagesNormalized).toBe(0);
  }, 15000);

  test('clears normalized directory contents without removing the root directory itself', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const workspaceRoot = actualFs.mkdtempSync(join(tmpdir(), 'pbinfo-normalize-root-'));
    tempDirs.push(workspaceRoot);

    vi.resetModules();

    let rootDeletionAttempted = false;
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      let blockedRoot: string | undefined;

      return {
        ...actual,
        rmSync(target: Parameters<typeof actual.rmSync>[0], options?: Parameters<typeof actual.rmSync>[1]) {
          if (blockedRoot !== undefined && String(target) === blockedRoot) {
            rootDeletionAttempted = true;
            const error = new Error('Permission denied') as NodeJS.ErrnoException;
            error.code = 'EPERM';
            throw error;
          }

          return actual.rmSync(target, options);
        },
        mkdirSync(target: Parameters<typeof actual.mkdirSync>[0], options?: Parameters<typeof actual.mkdirSync>[1]) {
          if (String(target).endsWith(`${sep}normalized${sep}evaluations`)) {
            blockedRoot = String(target);
          }
          return actual.mkdirSync(target, options);
        },
      };
    });

    const { prepareSnapshot } = await import('../../src/archive/storage.js');
    const { loadLocalConfig } = await import('../../src/config/local-config.js');
    const { runNormalizeSnapshotWorkflow } = await import('../../src/workflows/normalize-workflow.js');

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'normalize-root-preserve-snapshot',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });

    actualFs.mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    actualFs.mkdirSync(join(snapshot.normalizedRoot, 'evaluations'), { recursive: true });
    actualFs.writeFileSync(
      join(snapshot.normalizedRoot, 'evaluations', 'stale.json'),
      JSON.stringify({ stale: true }),
      'utf8',
    );

    const result = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId);

    expect(rootDeletionAttempted).toBe(false);
    expect(actualFs.existsSync(join(snapshot.normalizedRoot, 'evaluations'))).toBe(true);
    expect(actualFs.readdirSync(join(snapshot.normalizedRoot, 'evaluations'))).toEqual([]);
    expect(result.pagesNormalized).toBe(0);
  }, 15000);

  test('preserves official-source-list page kinds during normalize rebuilds', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const workspaceRoot = actualFs.mkdtempSync(join(tmpdir(), 'pbinfo-normalize-kind-remap-'));
    tempDirs.push(workspaceRoot);

    vi.resetModules();

    const observedKinds: string[] = [];
    vi.doMock('../../src/crawl/archive-crawler.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/crawl/archive-crawler.js')>(
        '../../src/crawl/archive-crawler.js',
      );
      return {
        ...actual,
        persistNormalizedSnapshotHtml(options: { item: { kind: string } }) {
          observedKinds.push(options.item.kind);
        },
      };
    });

    const { prepareSnapshot } = await import('../../src/archive/storage.js');
    const { loadLocalConfig } = await import('../../src/config/local-config.js');
    const { runNormalizeSnapshotWorkflow } = await import('../../src/workflows/normalize-workflow.js');

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'normalize-kind-remap-snapshot',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });

    actualFs.mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    actualFs.mkdirSync(snapshot.rawPagesRoot, { recursive: true });

    actualFs.writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'author-scoped-source-list.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          url: 'https://www.pbinfo.ro/solutii/user/Prekzursil/problema/2855/subseqsum-hard',
          kind: 'official-source-list',
          httpStatus: 200,
          bodyPath: 'raw-pages/page-source-list-2855.html',
          fetchedAt: '2026-03-18T00:00:00.000Z',
        },
        null,
        2,
      ),
      'utf8',
    );
    actualFs.writeFileSync(
      join(snapshot.rawPagesRoot, 'page-source-list-2855.html'),
      '<html><body>ok</body></html>',
      'utf8',
    );

    const result = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId);

    expect(result.pagesNormalized).toBe(1);
    expect(observedKinds).toEqual(['official-source-list']);
  }, 15000);

  test('preserves official-evaluation-detail page kinds during normalize rebuilds', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const workspaceRoot = actualFs.mkdtempSync(join(tmpdir(), 'pbinfo-normalize-evaluation-kind-remap-'));
    tempDirs.push(workspaceRoot);

    vi.resetModules();

    const observedKinds: string[] = [];
    vi.doMock('../../src/crawl/archive-crawler.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/crawl/archive-crawler.js')>(
        '../../src/crawl/archive-crawler.js',
      );
      return {
        ...actual,
        persistNormalizedSnapshotHtml(options: { item: { kind: string } }) {
          observedKinds.push(options.item.kind);
        },
      };
    });

    const { prepareSnapshot } = await import('../../src/archive/storage.js');
    const { loadLocalConfig } = await import('../../src/config/local-config.js');
    const { runNormalizeSnapshotWorkflow } = await import('../../src/workflows/normalize-workflow.js');

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'normalize-evaluation-kind-remap-snapshot',
      scope: 'all',
      now: new Date('2026-03-18T00:00:00.000Z'),
    });

    actualFs.mkdirSync(join(snapshot.normalizedRoot, 'pages'), { recursive: true });
    actualFs.mkdirSync(snapshot.rawPagesRoot, { recursive: true });

    actualFs.writeFileSync(
      join(snapshot.normalizedRoot, 'pages', 'official-evaluation-detail.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          url: 'https://www.pbinfo.ro/detalii-evaluare/63436915',
          kind: 'official-evaluation-detail',
          httpStatus: 200,
          bodyPath: 'raw-pages/page-evaluation-63436915.html',
          fetchedAt: '2026-03-18T00:00:00.000Z',
        },
        null,
        2,
      ),
      'utf8',
    );
    actualFs.writeFileSync(
      join(snapshot.rawPagesRoot, 'page-evaluation-63436915.html'),
      [
        '<html><body>',
        '<div id="rezumat">',
        '<table>',
        '<tr><th>Problema</th><td><a href="/probleme/2855/subseqsum-hard">subseqsum-hard</a></td></tr>',
        '<tr><th>Utilizator</th><td>Andrei Visalon (Prekzursil)</td></tr>',
        '<tr><th>Limbaj</th><td>C</td></tr>',
        '<tr><th>Punctaj</th><td>100</td></tr>',
        '<tr><th>Verdict</th><td>Corect</td></tr>',
        '</table>',
        '</div>',
        '</body></html>',
      ].join(''),
      'utf8',
    );

    const result = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshot.snapshotId);

    expect(result.pagesNormalized).toBe(1);
    expect(observedKinds).toEqual(['official-evaluation-detail']);
  }, 15000);
});
