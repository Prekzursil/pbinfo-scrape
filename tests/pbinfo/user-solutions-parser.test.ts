import { describe, expect, test } from 'vitest';

import { parseUserSolutionsListPage } from '../../src/pbinfo/parsers/user-solutions.js';

describe('parseUserSolutionsListPage', () => {
  test('parses table rows, dedupes evaluations, reads scores, and prefers handle from parentheses', () => {
    const html = `
      <div class="bold mb-3">12 rezultate</div>
      <table>
        <tr>
          <td><a href="/profil/silviu">Candale Silviu (silviu)</a></td>
          <td><a href="/probleme/10/suma">Suma</a></td>
          <td><a href="/detalii-evaluare/100">vezi</a></td>
          <td>100</td>
        </tr>
        <tr>
          <td><a href="/profil/silviu">silviu</a></td>
          <td><a href="/probleme/10/suma">Suma</a></td>
          <td><a href="/detalii-evaluare/100">vezi</a></td>
          <td>100</td>
        </tr>
        <tr>
          <td>no anchors here</td>
        </tr>
      </table>
    `;

    const parsed = parseUserSolutionsListPage(html);
    expect(parsed.totalMatches).toBe(12);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({
      user: 'silviu',
      problemId: 10,
      problemSlug: 'suma',
      evaluationId: 100,
      score: 100,
    });
  });

  test('detects throttling messages and falls back to anchor triplets when there is no table', () => {
    const html = `
      <p>Resursă indisponibilă temporar</p>
      <a href="/profil/Prekzursil">Prekzursil</a>
      <a href="/probleme/20/divizori">Divizori</a>
      <a href="/detalii-evaluare/200">vezi</a>
      <a href="/profil/Prekzursil">Prekzursil</a>
      <a href="/probleme/20/divizori">Divizori</a>
      <a href="/detalii-evaluare/200">vezi</a>
      <a href="/profil/Prekzursil">Prekzursil</a>
      <a href="/about">not a problem link</a>
    `;

    const parsed = parseUserSolutionsListPage(html);
    expect(parsed.throttled).toBe(true);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({ evaluationId: 200, problemId: 20 });
  });

  test('derives pagination next-page urls from the Paginare directive relative to the page url', () => {
    const html = `
      <div class="bold mb-3">30 rezultate</div>
      <script>Paginare(30, 0, 10)</script>
    `;

    const parsed = parseUserSolutionsListPage(
      html,
      'https://www.pbinfo.ro/solutii/user/silviu?start=0',
    );
    expect(parsed.pageSize).toBe(10);
    expect(parsed.currentOffset).toBe(0);
    expect(parsed.nextPageUrls).toEqual([
      'https://www.pbinfo.ro/solutii/user/silviu?start=10',
      'https://www.pbinfo.ro/solutii/user/silviu?start=20',
    ]);
  });

  test('ignores invalid Paginare directives', () => {
    const html = '<script>Paginare(30, 0, 0)</script>';
    const parsed = parseUserSolutionsListPage(html, 'https://www.pbinfo.ro/solutii/user/silviu');
    expect(parsed.pageSize).toBeUndefined();
    expect(parsed.nextPageUrls).toEqual([]);
  });

  test('extracts explicit pagination anchors and skips off-site or backward links', () => {
    const html = `
      <div class="pagination">
        <a href="?start=20">2</a>
        <a href="?start=10">next</a>
        <a href="?start=0">back to start</a>
        <a href="https://other.example/?start=99">offsite</a>
        <a>missing href</a>
      </div>
    `;

    const parsed = parseUserSolutionsListPage(
      html,
      'https://www.pbinfo.ro/solutii/user/silviu?start=5',
    );
    expect(parsed.nextPageUrls).toEqual([
      'https://www.pbinfo.ro/solutii/user/silviu?start=10',
      'https://www.pbinfo.ro/solutii/user/silviu?start=20',
    ]);
  });

  test('returns no pagination metadata or entries for a bare page', () => {
    const parsed = parseUserSolutionsListPage('<html><body></body></html>');
    expect(parsed.entries).toEqual([]);
    expect(parsed.nextPageUrls).toEqual([]);
    expect(parsed.currentOffset).toBeUndefined();
  });
});
