import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { prepareSnapshot, type SnapshotLayout } from '../../src/archive/storage.js';
import { loadLocalConfig, type LoadedLocalConfig } from '../../src/config/local-config.js';
import { discoverNormalizedFollowUps, persistOfficialSourceHarvest } from '../../src/crawl/archive-crawler.js';

const tempDirs: string[] = [];
let config: LoadedLocalConfig;
let snapshot: SnapshotLayout;

beforeEach(() => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-discover-'));
  tempDirs.push(workspaceRoot);
  config = loadLocalConfig(workspaceRoot);
  config = { ...config, crawl: { ...config.crawl, userHandle: 'Prekzursil' } };
  snapshot = prepareSnapshot(config, { scope: 'all', snapshotId: 'discover', now: new Date('2026-03-10T00:00:00.000Z') });
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const kinds = (items: ReturnType<typeof discoverNormalizedFollowUps>) => items.map((i) => i.kind);

function sourceList(author: string | null, score = '100'): string {
  const authorBlock = author
    ? `<div class="border rounded p-2 bg-body-secondary"><span title="Postată de"><span class="pbi-widget-user pbi-widget-user-span"><a href="/profil/${author}">Name (${author})</a></span></span></div>`
    : '';
  return `${authorBlock}
    <div class="bold mb-3">2 soluții respectă criteriile.</div>
    <table class="table"><tbody>
      <tr><td><a href="/profil/${author ?? 'x'}">${author ?? 'x'}</a></td><td><a href="/probleme/3171/waterreserve">W</a></td><td><a href="/detalii-evaluare/70000001">Evaluare finalizată</a></td><td>${score}</td></tr>
      <tr><td><a href="/profil/${author ?? 'x'}">${author ?? 'x'}</a></td><td><a href="/probleme/3171/waterreserve">W</a></td><td><a href="/detalii-evaluare/70000002">Evaluare finalizată</a></td><td>40 puncte</td></tr>
    </tbody></table>
    <script>let tmp = Paginare(100, 0, 1);</script>`;
}

const userSolutions = `
  <div class="bold mb-3">2 soluții respectă criteriile.</div>
  <table class="table"><tbody>
    <tr><td><a href="/profil/Prekzursil">Andrei (Prekzursil)</a></td><td><a href="/probleme/1/sum">sum</a></td><td><a href="/detalii-evaluare/55">Evaluare finalizată</a></td></tr>
    <tr><td><a href="/profil/Other">Cineva (Other)</a></td><td><a href="/probleme/2/dif">dif</a></td><td><a href="/detalii-evaluare/56">Evaluare finalizată</a></td></tr>
  </tbody></table>
  <script>let tmp = Paginare(2, 0, 1);</script>`;

describe('discoverNormalizedFollowUps', () => {
  test('returns nothing for unrelated kinds', () => {
    expect(discoverNormalizedFollowUps(config, snapshot, 'https://www.pbinfo.ro/probleme', 'public-page', '<div></div>')).toEqual([]);
  });

  test('skips user-solutions whose base handle does not match', () => {
    expect(
      discoverNormalizedFollowUps(config, snapshot, 'https://www.pbinfo.ro/solutii/user/Other', 'user-solutions', userSolutions),
    ).toEqual([]);
  });

  test('queues problem and evaluation follow-ups for matching user-solution entries', () => {
    const items = discoverNormalizedFollowUps(config, snapshot, 'https://www.pbinfo.ro/solutii/user/Prekzursil', 'user-solutions', userSolutions);
    expect(kinds(items)).toContain('public-page');
    expect(kinds(items)).toContain('evaluation-detail');
    expect(kinds(items)).toContain('user-solutions');
  });

  test('redirects a community source list to the official author-scoped page', () => {
    const items = discoverNormalizedFollowUps(config, snapshot, 'https://www.pbinfo.ro/solutii/problema/3171/waterreserve', 'official-source-list', sourceList('pbinfo'));
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('official-source-list');
    expect(items[0]?.url).toContain('/solutii/user/pbinfo/problema/3171/waterreserve');
  });

  test('redirects a community source list with a non-official author to user-solutions', () => {
    const items = discoverNormalizedFollowUps(config, snapshot, 'https://www.pbinfo.ro/solutii/problema/3171/waterreserve', 'official-source-list', sourceList('randomuser'));
    expect(items[0]?.kind).toBe('user-solutions');
  });

  test('returns nothing for a community source list without an author', () => {
    expect(
      discoverNormalizedFollowUps(config, snapshot, 'https://www.pbinfo.ro/solutii/problema/3171/waterreserve', 'official-source-list', sourceList(null)),
    ).toEqual([]);
  });

  test('harvests official evaluations from an author-scoped source list', () => {
    const items = discoverNormalizedFollowUps(
      config,
      snapshot,
      'https://www.pbinfo.ro/solutii/user/pbinfo/problema/3171/waterreserve',
      'official-source-list',
      sourceList('pbinfo'),
    );
    const officialEvals = items.filter((i) => i.kind === 'official-evaluation-detail');
    expect(officialEvals).toHaveLength(1);
    expect(officialEvals[0]?.url).toContain('/detalii-evaluare/70000001');
  });

  test('persistOfficialSourceHarvest ignores non-author-scoped source list urls', () => {
    expect(() =>
      persistOfficialSourceHarvest(snapshot, 'https://www.pbinfo.ro/solutii/problema/1/x', undefined, []),
    ).not.toThrow();
  });
});
