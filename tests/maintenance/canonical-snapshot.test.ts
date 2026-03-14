import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  CANONICAL_SAMPLE_ROUTES,
  getCanonicalSnapshotPaths,
  readMirrorRouteIndex,
  scanCanonicalSnapshotFilesystem,
  selectCanonicalSampleRoutes,
} from '../../src/maintenance/canonical-snapshot.js';

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, {
        recursive: true,
        force: true,
      });
    }
  }
});

describe('canonical snapshot helpers', () => {
  test('resolves the canonical archive paths relative to the workspace root', () => {
    const paths = getCanonicalSnapshotPaths('C:/workspace');

    expect(paths.snapshotId).toBe('acceptance-20260310b');
    expect(paths.snapshotRoot.replace(/\\/g, '/')).toContain(
      '/archive/snapshots/acceptance-20260310b',
    );
    expect(paths.normalizedRoot.replace(/\\/g, '/')).toContain('/normalized');
    expect(paths.mirrorRoot.replace(/\\/g, '/')).toContain('/mirror');
  });

  test('reads mirror routes and validates required sample route files', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-canonical-test-'));
    cleanupPaths.push(root);

    const paths = getCanonicalSnapshotPaths(root);
    mkdirSync(paths.problemsRoot, {
      recursive: true,
    });
    mkdirSync(join(paths.mirrorRoot, 'site', 'probleme', '3171', 'waterreserve'), {
      recursive: true,
    });
    mkdirSync(join(paths.mirrorRoot, 'site', 'profil', 'Prekzursil'), {
      recursive: true,
    });
    mkdirSync(join(paths.mirrorRoot, 'site', 'detalii-evaluare', '63332367'), {
      recursive: true,
    });

    writeFileSync(join(paths.problemsRoot, 'problem-1.json'), '{}', 'utf8');
    writeFileSync(
      join(paths.mirrorRoot, 'site', 'probleme', '3171', 'waterreserve', 'index.html'),
      '<html>problem</html>',
      'utf8',
    );
    writeFileSync(
      join(paths.mirrorRoot, 'site', 'profil', 'Prekzursil', 'index.html'),
      '<html>profile</html>',
      'utf8',
    );
    writeFileSync(
      join(paths.mirrorRoot, 'site', 'detalii-evaluare', '63332367', 'index.html'),
      '<html>evaluation</html>',
      'utf8',
    );
    writeFileSync(
      paths.mirrorRoutesPath,
      JSON.stringify(
        CANONICAL_SAMPLE_ROUTES.map((route, index) => ({
          snapshotId: paths.snapshotId,
          route,
          mirrorFile: [
            'site/probleme/3171/waterreserve/index.html',
            'site/profil/Prekzursil/index.html',
            'site/detalii-evaluare/63332367/index.html',
          ][index],
        })),
        null,
        2,
      ),
      'utf8',
    );

    const routes = readMirrorRouteIndex(paths.mirrorRoutesPath);
    const sampleRoutes = selectCanonicalSampleRoutes(routes, paths.mirrorRoot);
    const summary = scanCanonicalSnapshotFilesystem(paths);

    expect(routes).toHaveLength(3);
    expect(sampleRoutes.every((route) => route.exists)).toBe(true);
    expect(summary.problemRecordCount).toBe(1);
    expect(summary.sampleRoutes.every((route) => route.exists)).toBe(true);
  });

  test('flags missing mirror sample routes as incomplete', () => {
    const missing = selectCanonicalSampleRoutes([], 'C:/does-not-exist');

    expect(missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: '/probleme/3171/waterreserve',
          exists: false,
        }),
      ]),
    );
  });
});
