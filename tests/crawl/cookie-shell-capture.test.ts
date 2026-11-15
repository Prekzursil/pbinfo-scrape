import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { prepareSnapshot, type SnapshotLayout } from '../../src/archive/storage.js';
import { loadLocalConfig, type LoadedLocalConfig } from '../../src/config/local-config.js';
import { persistNormalizedSnapshotHtml } from '../../src/crawl/archive-crawler.js';
import { readIdSweepRecord, recordIdSweepProbe } from '../../src/crawl/problem-id-sweep.js';
import type { CrawlQueueInput } from '../../src/types/crawl.js';

const tempDirs: string[] = [];
let config: LoadedLocalConfig;
let snapshot: SnapshotLayout;

beforeEach(() => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-cookie-shell-'));
  tempDirs.push(workspaceRoot);
  config = loadLocalConfig(workspaceRoot);
  snapshot = prepareSnapshot(config, {
    snapshotId: 'shell-snapshot',
    scope: 'public',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function persist(item: CrawlQueueInput, html: string): void {
  persistNormalizedSnapshotHtml({
    config,
    snapshot,
    item,
    html,
    httpStatus: 200,
    contentType: 'text/html',
    fetchedAt: '2026-03-10T00:00:00.000Z',
  });
}

// The live challenge shell: title + spinner div + js-challenge endpoint, as
// observed on https://www.pbinfo.ro/probleme/{id}/{wrong-slug} for an
// anonymous, non-challenge-cleared HTTP client.
const CHALLENGE_SHELL = `<!doctype html>
<html lang="en">
  <head><title>Verificare - pbinfo.ro</title></head>
  <body>
    <div class="my-5 text-dark" id="verificare">Verificare. <i class="fas fa-spinner fa-spin"></i></div>
    <script>$.ajax({url: "/ajx-module/js-challenge.php", type: "POST"});</script>
  </body>
</html>`;

const CANONICAL_URL = 'https://www.pbinfo.ro/probleme/4242/perle';
const STATEMENT_URL = 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-enunt.php?id=4242';
const SOLUTION_URL = 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-solutie.php?id=4242';
const TESTS_URL = 'https://www.pbinfo.ro/ajx-module/ajx-problema-afisare-teste.php?id=4242';

function seedSweepRecord(): void {
  recordIdSweepProbe(
    snapshot,
    {
      problemId: 4242,
      probe: 'live',
      httpStatus: 301,
      slug: 'perle',
      canonicalUrl: CANONICAL_URL,
    },
    '2026-03-10T00:00:00.000Z',
    true,
  );
}

describe('persistNormalizedSnapshotHtml cookie-shell guard', () => {
  test('does not archive a challenge shell as a problem page', () => {
    seedSweepRecord();
    persist({ key: `page:${CANONICAL_URL}`, url: CANONICAL_URL, kind: 'public-page' }, CHALLENGE_SHELL);

    expect(existsSync(join(snapshot.normalizedRoot, 'problems', 'problem-4242.json'))).toBe(false);
    expect(readIdSweepRecord(snapshot, 4242)).toMatchObject({
      classification: 'cookie-shell',
      captureStatus: 'cookie-shell',
    });
  });

  test('does not parse a challenge shell as a statement fragment', () => {
    seedSweepRecord();
    persist(
      {
        key: `problem-statement:${CANONICAL_URL}`,
        url: STATEMENT_URL,
        kind: 'problem-statement',
      },
      CHALLENGE_SHELL,
    );

    expect(existsSync(join(snapshot.normalizedRoot, 'problems', 'problem-4242.json'))).toBe(false);
    // Endpoint fragments do not drive sweep classification (the canonical
    // page capture does); the probe classification stays untouched.
    expect(readIdSweepRecord(snapshot, 4242)).toMatchObject({ classification: 'live' });
  });

  test('does not record a challenge shell as a visible editorial', () => {
    seedSweepRecord();
    persist(
      {
        key: `problem-solution:${CANONICAL_URL}`,
        url: SOLUTION_URL,
        kind: 'problem-solution',
      },
      CHALLENGE_SHELL,
    );

    const problemPath = join(snapshot.normalizedRoot, 'problems', 'problem-4242.json');
    expect(existsSync(problemPath)).toBe(false);
    expect(readIdSweepRecord(snapshot, 4242)).toMatchObject({ classification: 'live' });
  });

  test('does not record a challenge shell as visible tests', () => {
    seedSweepRecord();
    persist(
      {
        key: `problem-tests:${CANONICAL_URL}`,
        url: TESTS_URL,
        kind: 'problem-tests',
      },
      CHALLENGE_SHELL,
    );

    expect(existsSync(join(snapshot.normalizedRoot, 'problems', 'problem-4242.json'))).toBe(false);
    expect(existsSync(join(snapshot.normalizedRoot, 'tests', 'problem-4242.json'))).toBe(false);
    expect(readIdSweepRecord(snapshot, 4242)).toMatchObject({ classification: 'live' });
  });

  test('marks a real capture as content for swept problems', () => {
    seedSweepRecord();
    persist(
      { key: `page:${CANONICAL_URL}`, url: CANONICAL_URL, kind: 'public-page' },
      '<html><body><h1><a href="/probleme/4242/perle">Perle</a></h1></body></html>',
    );

    expect(existsSync(join(snapshot.normalizedRoot, 'problems', 'problem-4242.json'))).toBe(true);
    expect(readIdSweepRecord(snapshot, 4242)).toMatchObject({
      classification: 'live',
      captureStatus: 'content',
    });
  });

  test('capture guards are inert for problems outside a sweep run', () => {
    // No id-sweep record seeded: the shell guard must still skip parsing
    // (no fabricated problem record) without creating sweep state.
    persist({ key: `page:${CANONICAL_URL}`, url: CANONICAL_URL, kind: 'public-page' }, CHALLENGE_SHELL);

    expect(existsSync(join(snapshot.normalizedRoot, 'problems', 'problem-4242.json'))).toBe(false);
    expect(readIdSweepRecord(snapshot, 4242)).toBeUndefined();
  });
});
