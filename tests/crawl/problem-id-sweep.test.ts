import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import {
  buildIdSweepIndex,
  buildProblemIdProbeUrl,
  detectProblemIdCeiling,
  isCookieShellHtml,
  parseProblemIdProbeResponse,
  readIdSweepRecord,
  recordIdSweepCaptureStatus,
  recordIdSweepProbe,
  writeIdSweepIndex,
} from '../../src/crawl/problem-id-sweep.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createSnapshot() {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-id-sweep-'));
  tempDirs.push(root);
  const config = loadLocalConfig(root);
  return prepareSnapshot(config, {
    snapshotId: 'sweep-20260310T000000Z',
    scope: 'public',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });
}

const LIVE_PROBE = (problemId: number, slug = `slug-${problemId}`) => ({
  problemId,
  probe: 'live' as const,
  httpStatus: 301,
  slug,
  canonicalUrl: `https://www.pbinfo.ro/probleme/${problemId}/${slug}`,
});

describe('buildProblemIdProbeUrl', () => {
  test('builds the bare no-slug probe URL', () => {
    expect(buildProblemIdProbeUrl(4242)).toBe('https://www.pbinfo.ro/probleme/4242');
  });
});

describe('parseProblemIdProbeResponse', () => {
  test('classifies a canonical redirect as live and extracts the slug', () => {
    const result = parseProblemIdProbeResponse(
      100,
      301,
      'https://www.pbinfo.ro/probleme/100/nrapprime',
    );
    expect(result).toEqual(LIVE_PROBE(100, 'nrapprime'));
  });

  test('accepts every redirect status family', () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const result = parseProblemIdProbeResponse(
        7,
        status,
        `https://www.pbinfo.ro/probleme/7/slug-7`,
      );
      expect(result.probe).toBe('live');
    }
  });

  test('resolves a relative Location header against the pbinfo origin', () => {
    const result = parseProblemIdProbeResponse(12, 301, '/probleme/12/slug-12');
    expect(result.probe).toBe('live');
    expect(result.canonicalUrl).toBe('https://www.pbinfo.ro/probleme/12/slug-12');
  });

  test('classifies a missing slug redirect as dead', () => {
    const result = parseProblemIdProbeResponse(9, 301, 'https://www.pbinfo.ro/probleme/9');
    expect(result).toEqual({ problemId: 9, probe: 'dead', httpStatus: 301 });
  });

  test('classifies a redirect to a different problem id as dead', () => {
    const result = parseProblemIdProbeResponse(
      9,
      301,
      'https://www.pbinfo.ro/probleme/100/nrapprime',
    );
    expect(result.probe).toBe('dead');
  });

  test('classifies a non-redirect response without location as dead', () => {
    expect(parseProblemIdProbeResponse(11, 200, null).probe).toBe('dead');
    expect(parseProblemIdProbeResponse(11, 200, 'https://www.pbinfo.ro/').probe).toBe('dead');
    expect(parseProblemIdProbeResponse(11, 404, null).probe).toBe('dead');
  });
});

describe('isCookieShellHtml', () => {
  test('detects the Verificare challenge shell by title, marker div, and endpoint', () => {
    expect(
      isCookieShellHtml('<html><head><title>Verificare - pbinfo.ro</title></head></html>'),
    ).toBe(true);
    expect(isCookieShellHtml('<body><div id="verificare">Verificare.</div></body>')).toBe(true);
    expect(
      isCookieShellHtml('<script>$.ajax({url: "/ajx-module/js-challenge.php"})</script>'),
    ).toBe(true);
  });

  test('does not flag real problem content', () => {
    expect(
      isCookieShellHtml(
        '<html><head><title>#4242 Perle</title></head><body><article><div id="enunt"><h1>Cerinta</h1></div></article></body></html>',
      ),
    ).toBe(false);
  });
});

describe('detectProblemIdCeiling', () => {
  test('binary-searches the exact boundary above the last live id', async () => {
    const liveUpTo = 10;
    const probes: number[] = [];
    const result = await detectProblemIdCeiling(
      async (id) => {
        probes.push(id);
        return id <= liveUpTo;
      },
      { startId: 1, deadStreakThreshold: 3 },
    );

    expect(result.ceiling).toBe(liveUpTo);
    expect(probes).toContain(liveUpTo);
    expect(probes.filter((id) => id > liveUpTo).length).toBeGreaterThanOrEqual(3);
  });

  test('returns ceiling 0 when no probe in the window is live', async () => {
    const result = await detectProblemIdCeiling(async () => false, {
      startId: 1,
      deadStreakThreshold: 2,
    });
    expect(result.ceiling).toBe(0);
    expect(result.probedIds).toHaveLength(2);
  });

  test('handles a gap below the ceiling and still finds the highest live id', async () => {
    const liveIds = new Set([1, 2, 4, 5]);
    const result = await detectProblemIdCeiling((id) => Promise.resolve(liveIds.has(id)), {
      startId: 1,
      deadStreakThreshold: 3,
    });
    expect(result.ceiling).toBe(5);
  });

  test('clamps startId below 1 and deadStreakThreshold below 2', async () => {
    const seen: number[] = [];
    const result = await detectProblemIdCeiling(
      async (id) => {
        seen.push(id);
        return id <= 1;
      },
      { startId: -5, deadStreakThreshold: 1 },
    );
    expect(result.ceiling).toBe(1);
    expect(seen[0]).toBe(1);
  });

  test('defaults startId to 1 and deadStreakThreshold to 8 when options are omitted', async () => {
    const seen: number[] = [];
    const result = await detectProblemIdCeiling(async (id) => {
      seen.push(id);
      return id <= 1;
    });
    expect(result.ceiling).toBe(1);
    // startId defaults to 1; the default dead-streak threshold of 8 means
    // the growth phase probes ids 1..9 (1 live, then 8 consecutive dead).
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('id-sweep records', () => {
  test('persists probe records and reads them back', () => {
    const snapshot = createSnapshot();
    const live = recordIdSweepProbe(
      snapshot,
      LIVE_PROBE(4242, 'perle'),
      '2026-03-10T00:00:00.000Z',
      true,
    );
    expect(live).toMatchObject({
      problemId: 4242,
      classification: 'live',
      probe: 'live',
      captureQueued: true,
      slug: 'perle',
    });

    const dead = recordIdSweepProbe(
      snapshot,
      { problemId: 4243, probe: 'dead', httpStatus: 200 },
      '2026-03-10T00:00:00.000Z',
      false,
    );
    expect(dead.classification).toBe('dead');

    expect(readIdSweepRecord(snapshot, 4242)).toMatchObject({
      problemId: 4242,
      classification: 'live',
    });
    expect(readIdSweepRecord(snapshot, 4243)).toMatchObject({
      problemId: 4243,
      classification: 'dead',
    });
    expect(readIdSweepRecord(snapshot, 9999)).toBeUndefined();
  });

  test('updates classification only for existing sweep records', () => {
    const snapshot = createSnapshot();
    recordIdSweepProbe(snapshot, LIVE_PROBE(4242, 'perle'), '2026-03-10T00:00:00.000Z', true);

    expect(recordIdSweepCaptureStatus(snapshot, 4242, 'cookie-shell')).toBe(true);
    expect(readIdSweepRecord(snapshot, 4242)).toMatchObject({
      classification: 'cookie-shell',
      captureStatus: 'cookie-shell',
      slug: 'perle',
    });

    expect(recordIdSweepCaptureStatus(snapshot, 4242, 'content')).toBe(true);
    expect(readIdSweepRecord(snapshot, 4242)).toMatchObject({
      classification: 'live',
      captureStatus: 'content',
    });

    expect(recordIdSweepCaptureStatus(snapshot, 12345, 'content')).toBe(false);
  });
});

describe('id-sweep index', () => {
  test('summarizes classifications with sorted id buckets', () => {
    const snapshot = createSnapshot();
    recordIdSweepProbe(snapshot, LIVE_PROBE(2), '2026-03-10T00:00:00.000Z', true);
    recordIdSweepProbe(
      snapshot,
      { problemId: 3, probe: 'dead', httpStatus: 200 },
      '2026-03-10T00:00:00.000Z',
      false,
    );
    recordIdSweepProbe(snapshot, LIVE_PROBE(4), '2026-03-10T00:00:00.000Z', true);
    recordIdSweepCaptureStatus(snapshot, 4, 'cookie-shell');
    recordIdSweepProbe(snapshot, LIVE_PROBE(1), '2026-03-10T00:00:00.000Z', true);

    const records = [1, 2, 3, 4]
      .map((id) => readIdSweepRecord(snapshot, id))
      .filter((record) => record !== undefined);
    const index = buildIdSweepIndex(snapshot.snapshotId, records, 4, '2026-03-10T01:00:00.000Z');

    expect(index.snapshotId).toBe('sweep-20260310T000000Z');
    expect(index.ceiling).toBe(4);
    expect(index.totals).toEqual({
      probed: 4,
      liveCount: 2,
      deadCount: 1,
      cookieShellCount: 1,
      minId: 1,
      maxId: 4,
    });
    expect(index.liveIds).toEqual([1, 2]);
    expect(index.deadIds).toEqual([3]);
    expect(index.cookieShellIds).toEqual([4]);

    writeIdSweepIndex(snapshot, index);
    const persisted = JSON.parse(
      readFileSync(join(snapshot.normalizedRoot, 'id-sweep', 'index.json'), 'utf8'),
    );
    expect(persisted.totals.probed).toBe(4);
  });

  test('builds an empty index for a ceiling below the sweep floor', () => {
    const snapshot = createSnapshot();
    const index = buildIdSweepIndex(snapshot.snapshotId, [], 0, '2026-03-10T01:00:00.000Z');
    expect(index.totals).toEqual({
      probed: 0,
      liveCount: 0,
      deadCount: 0,
      cookieShellCount: 0,
      minId: 0,
      maxId: 0,
    });
    writeIdSweepIndex(snapshot, index);
    expect(existsSync(join(snapshot.normalizedRoot, 'id-sweep', 'index.json'))).toBe(true);
  });
});

describe('snapshot id-sweep directory', () => {
  test('is created under the snapshot normalized root on first write', () => {
    const snapshot = createSnapshot();
    recordIdSweepProbe(
      snapshot,
      { problemId: 1, probe: 'dead', httpStatus: 200 },
      '2026-03-10T00:00:00.000Z',
      false,
    );
    expect(existsSync(join(snapshot.normalizedRoot, 'id-sweep', 'id-1.json'))).toBe(true);
  });
});
