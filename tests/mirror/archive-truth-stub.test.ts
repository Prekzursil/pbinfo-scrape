import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { loadLocalConfig } from '../../src/config/local-config.js';
import { prepareSnapshot } from '../../src/archive/storage.js';
import { startMirrorServer } from '../../src/mirror/server.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function seedEmptyMirror(): Promise<{
  workspaceRoot: string;
  snapshotId: string;
}> {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-archive-truth-'));
  tempDirs.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
  writeFileSync(
    join(workspaceRoot, '.local', 'pbinfo.local.json'),
    JSON.stringify({ crawl: { userHandle: 'Prekzursil' } }, null, 2),
    'utf8',
  );
  const config = loadLocalConfig(workspaceRoot);
  const snapshot = prepareSnapshot(config, {
    snapshotId: 'archive-truth-test',
    scope: 'all',
    now: new Date('2026-04-23T00:00:00.000Z'),
  });
  mkdirSync(snapshot.mirrorRoot, { recursive: true });
  // Seed with one known route so startMirrorServer's "requires built mirror"
  // guard passes.
  writeFileSync(
    snapshot.routesManifestPath,
    JSON.stringify(
      [
        {
          route: '/',
          sourceFile: 'home.html',
          mirrorFile: 'home.html',
        },
      ],
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(join(snapshot.mirrorRoot, 'home.html'), '<html><body>home</body></html>', 'utf8');
  return { workspaceRoot, snapshotId: snapshot.snapshotId };
}

describe('mirror archive-truth stub', () => {
  test('serves "not archived yet" stub with live link for pbinfo.ro URLs', async () => {
    const { workspaceRoot, snapshotId } = await seedEmptyMirror();
    const mirror = await startMirrorServer({ workspaceRoot, port: 0, snapshotId });
    try {
      const url =
        `${mirror.baseUrl}/__not-archived?original=` +
        encodeURIComponent('https://www.pbinfo.ro/probleme/999999/missing');
      const response = await fetch(url);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('Not archived yet');
      expect(body).toContain('https://www.pbinfo.ro/probleme/999999/missing');
      expect(body).toContain('Open on live pbinfo.ro');
      expect(body).toContain(snapshotId);
    } finally {
      await mirror.close();
    }
  });

  test('rejects non-pbinfo URLs in ?original= and renders the fallback without a live button', async () => {
    const { workspaceRoot, snapshotId } = await seedEmptyMirror();
    const mirror = await startMirrorServer({ workspaceRoot, port: 0, snapshotId });
    try {
      const url =
        `${mirror.baseUrl}/__not-archived?original=` +
        encodeURIComponent('https://evil.example.com/phish');
      const response = await fetch(url);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain('evil.example.com');
      expect(body).toContain('No live pbinfo.ro URL is known');
    } finally {
      await mirror.close();
    }
  });

  test('an unknown mirror route renders the archive-truth stub inline with 404 status', async () => {
    const { workspaceRoot, snapshotId } = await seedEmptyMirror();
    const mirror = await startMirrorServer({ workspaceRoot, port: 0, snapshotId });
    try {
      const response = await fetch(`${mirror.baseUrl}/probleme/999999/ghost`);
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).toContain('Not archived yet');
      expect(body).toContain('https://www.pbinfo.ro/probleme/999999/ghost');
      expect(body).toContain(snapshotId);
    } finally {
      await mirror.close();
    }
  });

  test('an unknown mirror route on a non-pbinfo path still renders the stub without a live link', async () => {
    const { workspaceRoot, snapshotId } = await seedEmptyMirror();
    const mirror = await startMirrorServer({ workspaceRoot, port: 0, snapshotId });
    try {
      const response = await fetch(`${mirror.baseUrl}/arbitrary/path/not-in-manifest`);
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).toContain('Not archived yet');
      expect(body).toContain('No live pbinfo.ro URL is known');
    } finally {
      await mirror.close();
    }
  });
});
