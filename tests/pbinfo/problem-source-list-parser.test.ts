import { describe, expect, test } from 'vitest';

import { parseProblemSourceListPage } from '../../src/pbinfo/parsers/problem-source-list.js';

describe('parseProblemSourceListPage', () => {
  test('extracts 100-point and sub-100 entries plus pagination metadata from tabular source lists', () => {
    const pageUrl = 'https://www.pbinfo.ro/solutii/problema/3171/waterreserve';
    const parsed = parseProblemSourceListPage(
      `
        <div class="border rounded p-2 bg-body-secondary">
          <span class="badge bg-secondary-subtle text-decoration-none me-2" title="Postată de">
            <span class="pbi-widget-user pbi-widget-user-span">
              <a href="/profil/pbinfo" class="text-decoration-none">PBInfo (pbinfo)</a>
            </span>
          </span>
        </div>
        <div class="bold mb-3">3 soluții respectă criteriile.</div>
        <table class="table">
          <tbody>
            <tr>
              <td><a href="/profil/pbinfo">pbinfo</a></td>
              <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
              <td><a href="/detalii-evaluare/70000001">Evaluare finalizată</a></td>
              <td>100 puncte</td>
            </tr>
            <tr>
              <td><a href="/profil/pbinfo">pbinfo</a></td>
              <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
              <td><a href="/detalii-evaluare/70000002">Evaluare finalizată</a></td>
              <td>40 puncte</td>
            </tr>
          </tbody>
        </table>
        <script>
          let tmp = Paginare(3, 0, 1);
        </script>
      `,
      pageUrl,
    );

    expect(parsed.authorHandle).toBe('pbinfo');
    expect(parsed.totalMatches).toBe(3);
    expect(parsed.entries).toEqual([
      {
        user: 'pbinfo',
        problemId: 3171,
        problemSlug: 'waterreserve',
        problemName: 'WaterReserve',
        evaluationId: 70000001,
        score: 100,
      },
      {
        user: 'pbinfo',
        problemId: 3171,
        problemSlug: 'waterreserve',
        problemName: 'WaterReserve',
        evaluationId: 70000002,
        score: 40,
      },
    ]);
    expect(parsed.pageSize).toBe(1);
    expect(parsed.currentOffset).toBe(0);
    expect(parsed.nextPageUrls).toEqual([
      'https://www.pbinfo.ro/solutii/problema/3171/waterreserve?start=1',
      'https://www.pbinfo.ro/solutii/problema/3171/waterreserve?start=2',
    ]);
  });

  test('prefers explicit pagination links and deduplicates repeated evaluation ids', () => {
    const pageUrl = 'https://www.pbinfo.ro/solutii/problema/1/sum';
    const parsed = parseProblemSourceListPage(
      `
        <table class="table">
          <tbody>
            <tr>
              <td><a href="/profil/pbinfo">pbinfo</a></td>
              <td><a href="/probleme/1/sum">sum</a></td>
              <td><a href="/detalii-evaluare/123">Evaluare</a></td>
              <td>100</td>
            </tr>
            <tr>
              <td><a href="/profil/pbinfo">pbinfo</a></td>
              <td><a href="/probleme/1/sum">sum</a></td>
              <td><a href="/detalii-evaluare/123">Evaluare</a></td>
              <td>100</td>
            </tr>
          </tbody>
        </table>
        <div class="pagination">
          <a href="/solutii/problema/1/sum?start=25">următoarea</a>
          <a href="/solutii/problema/1/sum?start=50">ultima</a>
        </div>
      `,
      pageUrl,
    );

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.evaluationId).toBe(123);
    expect(parsed.nextPageUrls).toEqual([
      'https://www.pbinfo.ro/solutii/problema/1/sum?start=25',
      'https://www.pbinfo.ro/solutii/problema/1/sum?start=50',
    ]);
  });
});
