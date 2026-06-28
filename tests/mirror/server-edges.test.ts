import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { startMirrorServer, type RunningMirrorServer } from '../../src/mirror/server.js';

const tempDirs: string[] = [];
const runningServers: RunningMirrorServer[] = [];

afterEach(async () => {
  for (const server of runningServers.splice(0)) {
    await server.close().catch(() => undefined);
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

function buildWorkspace(routes: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-mirror-'));
  tempDirs.push(root);
  const snapshotId = 'S1';
  writeJson(join(root, 'archive', 'catalog.json'), {
    currentSnapshotId: snapshotId,
    canonicalSnapshotId: snapshotId,
    snapshots: [
      { snapshotId, createdAt: '2026-01-01T00:00:00Z', scope: 'all', status: 'completed', checkpoint: 'canonical' },
    ],
    artifactExports: [],
  });
  const snapRoot = join(root, 'archive', 'snapshots', snapshotId);
  writeJson(join(snapRoot, 'mirror', 'routes.json'), routes);
  return root;
}

describe('startMirrorServer', () => {
  test('throws when no mirror routes are built', async () => {
    const root = buildWorkspace([]);
    await expect(startMirrorServer({ workspaceRoot: root, port: 0 })).rejects.toThrow(/requires a built mirror/);
  });

  test('throws when the routes manifest file does not exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-mirror-noroutes-'));
    tempDirs.push(root);
    writeJson(join(root, 'archive', 'catalog.json'), {
      currentSnapshotId: 'S1',
      canonicalSnapshotId: 'S1',
      snapshots: [
        { snapshotId: 'S1', createdAt: '2026-01-01T00:00:00Z', scope: 'all', status: 'completed', checkpoint: 'canonical' },
      ],
      artifactExports: [],
    });
    await expect(startMirrorServer({ workspaceRoot: root, port: 0 })).rejects.toThrow(/requires a built mirror/);
  });

  test('serves mirror, raw, asset, 404 and 500 routes and closes', async () => {
    const root = buildWorkspace([
      { route: '/', sourceFile: 'index.html', mirrorFile: 'index.mirror.html' },
      { route: '/rawonly', sourceFile: 'raw.html' },
      { route: '/mirror-missing', sourceFile: 'raw2.html', mirrorFile: 'nope.html' },
      { route: '/missing-raw', sourceFile: 'gone.html' },
    ]);
    const snapRoot = join(root, 'archive', 'snapshots', 'S1');
    const mirrorRoot = join(snapRoot, 'mirror');
    const rawPagesRoot = join(root, 'output', 'artifacts', 'S1', 'raw-pages');
    const rawAssetsRoot = join(root, 'output', 'artifacts', 'S1', 'raw-assets');
    mkdirSync(rawPagesRoot, { recursive: true });
    mkdirSync(rawAssetsRoot, { recursive: true });
    writeFileSync(join(mirrorRoot, 'index.mirror.html'), '<html>mirror</html>', 'utf8');
    writeFileSync(join(rawPagesRoot, 'raw.html'), '<html>raw</html>', 'utf8');
    writeFileSync(join(rawPagesRoot, 'raw2.html'), '<html>raw2</html>', 'utf8');
    writeFileSync(join(rawAssetsRoot, 'style.css'), 'body{}', 'utf8');

    const server = await startMirrorServer({ workspaceRoot: root, port: 0 });
    runningServers.push(server);

    expect(await (await fetch(`${server.baseUrl}/`)).text()).toContain('mirror');
    expect(await (await fetch(`${server.baseUrl}/rawonly`)).text()).toContain('raw');
    expect(await (await fetch(`${server.baseUrl}/mirror-missing`)).text()).toContain('raw2');

    const missingRaw = await fetch(`${server.baseUrl}/missing-raw`);
    expect(missingRaw.status).toBe(500);

    const unknown = await fetch(`${server.baseUrl}/unknown`);
    expect(unknown.status).toBe(404);

    expect((await fetch(`${server.baseUrl}/_assets/style.css`)).status).toBe(200);
    expect((await fetch(`${server.baseUrl}/_assets/missing.css`)).status).toBe(404);

    await server.close();
    runningServers.splice(0);
    // Closing an already-closed server rejects via the error callback.
    await expect(server.close()).rejects.toBeTruthy();
  });
});
