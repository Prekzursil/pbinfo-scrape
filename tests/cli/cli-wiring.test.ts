import { describe, expect, test, vi } from 'vitest';

import { buildCli, type CliHandlers } from '../../src/cli.js';

function makeHandlers() {
  const handlers: Record<keyof CliHandlers, ReturnType<typeof vi.fn>> = {
    authLogin: vi.fn(async () => undefined),
    authStatus: vi.fn(async () => undefined),
    authImportCookies: vi.fn(async () => undefined),
    authImportBrowser: vi.fn(async () => undefined),
    authBundle: vi.fn(async () => undefined),
    authRestoreBundle: vi.fn(async () => undefined),
    crawl: vi.fn(async () => undefined),
    crawlOfficialSources: vi.fn(async () => undefined),
    crawlStatus: vi.fn(async () => undefined),
    normalizeSnapshot: vi.fn(async () => undefined),
    snapshotFinalize: vi.fn(async () => undefined),
    rank: vi.fn(async () => undefined),
    artifactsExportRaw: vi.fn(async () => undefined),
    artifactsImportRaw: vi.fn(async () => undefined),
    artifactsRelinkRaw: vi.fn(async () => undefined),
    buildMirror: vi.fn(async () => undefined),
    serve: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    publish: vi.fn(async () => undefined),
  };
  return handlers;
}

async function run(handlers: ReturnType<typeof makeHandlers>, args: string[]): Promise<void> {
  await buildCli(handlers as unknown as CliHandlers).parseAsync(['node', 'pbinfo', ...args]);
}

const WS = ['--workspace', '/ws'];

describe('buildCli action wiring', () => {
  test('routes every auth subcommand to its handler', async () => {
    const h = makeHandlers();
    await run(h, [...WS, 'auth', 'login']);
    expect(h.authLogin).toHaveBeenCalledWith('/ws');

    await run(h, [...WS, 'auth', 'status']);
    expect(h.authStatus).toHaveBeenCalledWith('/ws');

    await run(h, [...WS, 'auth', 'import-cookies', '--source', 'cookies.json']);
    expect(h.authImportCookies).toHaveBeenCalledWith('/ws', 'cookies.json');

    await run(h, [...WS, 'auth', 'import-browser', '--browser', 'edge', '--profile', 'Work', '--user-data-dir', 'D:/u']);
    expect(h.authImportBrowser).toHaveBeenCalledWith('/ws', 'edge', 'Work', 'D:/u');

    await run(h, [...WS, 'auth', 'bundle', '--recipient', 'age1xyz']);
    expect(h.authBundle).toHaveBeenCalledWith('/ws', 'age1xyz');

    await run(h, [...WS, 'auth', 'restore-bundle', '--source', 'b.age', '--identity', 'id.txt']);
    expect(h.authRestoreBundle).toHaveBeenCalledWith('/ws', 'b.age', 'id.txt');
  });

  test('routes crawl, normalize, snapshot, and rank commands', async () => {
    const h = makeHandlers();
    await run(h, [...WS, 'crawl', 'public', '--snapshot', 's1', '--acceptance', '--mode', 'fresh']);
    expect(h.crawl).toHaveBeenCalledWith('/ws', 'public', 's1', true, 'fresh');

    await run(h, ['crawl', 'user']);
    expect(h.crawl).toHaveBeenLastCalledWith(process.cwd(), 'user', undefined, undefined, 'incremental');

    await run(h, [...WS, 'crawl', 'all', '--mode', 'incremental']);
    expect(h.crawl).toHaveBeenLastCalledWith('/ws', 'all', undefined, undefined, 'incremental');

    await run(h, [...WS, 'crawl', 'official-sources', '--snapshot', 's2']);
    expect(h.crawlOfficialSources).toHaveBeenCalledWith('/ws', 's2');

    await run(h, [...WS, 'crawl', 'status']);
    expect(h.crawlStatus).toHaveBeenCalledWith('/ws', undefined);

    await run(h, [...WS, 'normalize', 'snapshot', '--snapshot', 's3']);
    expect(h.normalizeSnapshot).toHaveBeenCalledWith('/ws', 's3');

    await run(h, [...WS, 'snapshot', 'finalize', '--snapshot', 's4', '--promote']);
    expect(h.snapshotFinalize).toHaveBeenCalledWith('/ws', 's4', true);

    await run(h, [...WS, 'rank', '--snapshot', 's5']);
    expect(h.rank).toHaveBeenCalledWith('/ws', 's5');
  });

  test('routes artifacts and secrets commands', async () => {
    const h = makeHandlers();
    await run(h, [...WS, 'artifacts', 'export-raw', '--snapshot', 's', '--target', '/out']);
    expect(h.artifactsExportRaw).toHaveBeenCalledWith('/ws', 's', '/out');

    await run(h, [...WS, 'artifacts', 'import-raw', '--source', '/m.json']);
    expect(h.artifactsImportRaw).toHaveBeenCalledWith('/ws', undefined, '/m.json');

    await run(h, [...WS, 'artifacts', 'relink-raw', '--snapshot', 's', '--source', '/m.json']);
    expect(h.artifactsRelinkRaw).toHaveBeenCalledWith('/ws', 's', '/m.json');

    await run(h, [...WS, 'secrets', 'bootstrap', '--recipient', 'age1abc']);
    expect(h.authBundle).toHaveBeenLastCalledWith('/ws', 'age1abc');

    await run(h, [...WS, 'secrets', 'restore', '--source', 'b.age']);
    expect(h.authRestoreBundle).toHaveBeenLastCalledWith('/ws', 'b.age', undefined);
  });

  test('routes mirror, serve, resume, and publish commands', async () => {
    const h = makeHandlers();
    await run(h, [...WS, 'build-mirror', '--snapshot', 's']);
    expect(h.buildMirror).toHaveBeenCalledWith('/ws', 's');

    await run(h, [...WS, 'serve', '--port', '5000', '--snapshot', 's']);
    expect(h.serve).toHaveBeenCalledWith('/ws', 5000, 's');

    await run(h, [...WS, 'resume', '--snapshot', 's']);
    expect(h.resume).toHaveBeenCalledWith('/ws', 's');

    await run(h, [...WS, 'publish', '--snapshot', 's', '--release', '--tag', 'v1.0.0', '--upload-desktop-exe']);
    expect(h.publish).toHaveBeenCalledWith('/ws', 's', true, 'v1.0.0', true);
  });
});
