import { describe, expect, test, vi } from 'vitest';

import { buildCli, type CliHandlers } from '../../src/cli.js';

function stubHandlers(): { handlers: CliHandlers; calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: keyof CliHandlers) =>
    vi.fn(async (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    });
  const handlers: CliHandlers = {
    authLogin: record('authLogin'),
    authStatus: record('authStatus'),
    authImportCookies: record('authImportCookies'),
    authImportBrowser: record('authImportBrowser'),
    authBundle: record('authBundle'),
    authRestoreBundle: record('authRestoreBundle'),
    crawl: record('crawl'),
    crawlOfficialSources: record('crawlOfficialSources'),
    crawlStatus: record('crawlStatus'),
    normalizeSnapshot: record('normalizeSnapshot'),
    snapshotFinalize: record('snapshotFinalize'),
    rank: record('rank'),
    artifactsExportRaw: record('artifactsExportRaw'),
    artifactsImportRaw: record('artifactsImportRaw'),
    artifactsRelinkRaw: record('artifactsRelinkRaw'),
    buildMirror: record('buildMirror'),
    serve: record('serve'),
    resume: record('resume'),
    publish: record('publish'),
  };
  return { handlers, calls };
}

async function run(args: string[], handlers: CliHandlers): Promise<void> {
  await buildCli(handlers).parseAsync(['node', 'pbinfo', ...args]);
}

describe('CLI action dispatch', () => {
  test('auth subcommands forward parsed options and the resolved workspace', async () => {
    const { handlers, calls } = stubHandlers();
    const ws = '/workspace';

    await run(['--workspace', ws, 'auth', 'login'], handlers);
    await run(['--workspace', ws, 'auth', 'status'], handlers);
    await run(['--workspace', ws, 'auth', 'import-cookies', '--source', '/c.json'], handlers);
    await run(
      [
        '--workspace',
        ws,
        'auth',
        'import-browser',
        '--browser',
        'edge',
        '--profile',
        'Default',
        '--user-data-dir',
        '/data',
      ],
      handlers,
    );
    await run(['--workspace', ws, 'auth', 'bundle', '--recipient', 'age1xyz'], handlers);
    await run(
      ['--workspace', ws, 'auth', 'restore-bundle', '--source', '/b.age', '--identity', '/id'],
      handlers,
    );

    expect(calls.authLogin).toEqual([[ws]]);
    expect(calls.authStatus).toEqual([[ws]]);
    expect(calls.authImportCookies).toEqual([[ws, '/c.json']]);
    expect(calls.authImportBrowser).toEqual([[ws, 'edge', 'Default', '/data']]);
    expect(calls.authBundle).toEqual([[ws, 'age1xyz']]);
    expect(calls.authRestoreBundle).toEqual([[ws, '/b.age', '/id']]);
  });

  test('crawl subcommands forward scope, snapshot, acceptance, and mode', async () => {
    const { handlers, calls } = stubHandlers();

    await run(['crawl', 'public', '--snapshot', 's1', '--acceptance', '--mode', 'fresh'], handlers);
    await run(['crawl', 'user', '--mode', 'incremental'], handlers);
    await run(['crawl', 'all'], handlers);
    await run(['crawl', 'official-sources', '--snapshot', 's2'], handlers);
    await run(['crawl', 'status', '--snapshot', 's3'], handlers);

    expect(calls.crawl?.[0]).toEqual([process.cwd(), 'public', 's1', true, 'fresh']);
    expect(calls.crawl?.[1]).toEqual([process.cwd(), 'user', undefined, undefined, 'incremental']);
    expect(calls.crawl?.[2]).toEqual([process.cwd(), 'all', undefined, undefined, 'incremental']);
    expect(calls.crawlOfficialSources).toEqual([[process.cwd(), 's2']]);
    expect(calls.crawlStatus).toEqual([[process.cwd(), 's3']]);
  });

  test('normalize, snapshot, rank, and artifacts subcommands forward their options', async () => {
    const { handlers, calls } = stubHandlers();

    await run(['normalize', 'snapshot', '--snapshot', 'n1'], handlers);
    await run(['snapshot', 'finalize', '--snapshot', 'f1', '--promote'], handlers);
    await run(['rank', '--snapshot', 'r1'], handlers);
    await run(['artifacts', 'export-raw', '--snapshot', 'e1', '--target', '/t'], handlers);
    await run(['artifacts', 'import-raw', '--snapshot', 'i1', '--source', '/s'], handlers);
    await run(['artifacts', 'relink-raw', '--snapshot', 'l1', '--source', '/m'], handlers);

    expect(calls.normalizeSnapshot).toEqual([[process.cwd(), 'n1']]);
    expect(calls.snapshotFinalize).toEqual([[process.cwd(), 'f1', true]]);
    expect(calls.rank).toEqual([[process.cwd(), 'r1']]);
    expect(calls.artifactsExportRaw).toEqual([[process.cwd(), 'e1', '/t']]);
    expect(calls.artifactsImportRaw).toEqual([[process.cwd(), 'i1', '/s']]);
    expect(calls.artifactsRelinkRaw).toEqual([[process.cwd(), 'l1', '/m']]);
  });

  test('secrets subcommands reuse the bundle and restore handlers', async () => {
    const { handlers, calls } = stubHandlers();

    await run(['secrets', 'bootstrap', '--recipient', 'age1abc'], handlers);
    await run(['secrets', 'restore', '--source', '/b.age', '--identity', '/id'], handlers);

    expect(calls.authBundle).toEqual([[process.cwd(), 'age1abc']]);
    expect(calls.authRestoreBundle).toEqual([[process.cwd(), '/b.age', '/id']]);
  });

  test('build-mirror, serve, resume, and publish subcommands forward their options', async () => {
    const { handlers, calls } = stubHandlers();

    await run(['build-mirror', '--snapshot', 'm1'], handlers);
    await run(['serve', '--port', '9090', '--snapshot', 'sv1'], handlers);
    await run(['resume', '--snapshot', 'rs1'], handlers);
    await run(
      ['publish', '--snapshot', 'p1', '--release', '--tag', 'v9', '--upload-desktop-exe'],
      handlers,
    );

    expect(calls.buildMirror).toEqual([[process.cwd(), 'm1']]);
    expect(calls.serve).toEqual([[process.cwd(), 9090, 'sv1']]);
    expect(calls.resume).toEqual([[process.cwd(), 'rs1']]);
    expect(calls.publish).toEqual([[process.cwd(), 'p1', true, 'v9', true]]);
  });
});
