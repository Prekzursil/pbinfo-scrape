import { describe, expect, test } from 'vitest';

import { loadHtml } from '../../src/pbinfo/parsers/shared.js';
import {
  extractCurrentOffset,
  extractExplicitPaginationUrls,
  extractPostedByHandleFromRows,
  extractRowScore,
  matchEvaluationHref,
  matchProblemHref,
  matchProfileHref,
  parsePaginationMetadata,
  parseTotalMatches,
  resolveProblemListingMatch,
} from '../../src/pbinfo/parsers/problem-listing-shared.js';

describe('problem-listing-shared helpers', () => {
  test('extractPostedByHandleFromRows ignores rows without the posted-by header', () => {
    const $ = loadHtml(`
      <table>
        <tr><th>Limbaj</th><td>C++</td></tr>
        <tr><th>Postată de</th><td><a href="/profil/Prekzursil">Andrei</a></td></tr>
      </table>
    `);

    expect(extractPostedByHandleFromRows($)).toBe('Prekzursil');
  });

  test('extractPostedByHandleFromRows returns undefined when no value cells are present', () => {
    const $ = loadHtml(`
      <table>
        <tr><th>Postată de</th></tr>
      </table>
    `);

    expect(extractPostedByHandleFromRows($)).toBeUndefined();
  });

  test('matchers return undefined for missing hrefs and null for non-matching hrefs', () => {
    expect(matchProblemHref(undefined)).toBeUndefined();
    expect(matchEvaluationHref(undefined)).toBeUndefined();
    expect(matchProfileHref(undefined)).toBeUndefined();
    expect(matchProblemHref('/not-a-problem')).toBeNull();
    expect(matchProblemHref('/probleme/12/slug')?.[1]).toBe('12');
  });

  test('resolveProblemListingMatch returns undefined for incomplete anchor triples', () => {
    expect(resolveProblemListingMatch('/probleme/1/sum', undefined)).toBeUndefined();
    expect(resolveProblemListingMatch(undefined, '/detalii-evaluare/5')).toBeUndefined();
    expect(resolveProblemListingMatch('/probleme/1/sum', '/detalii-evaluare/5')).toEqual({
      problemId: 1,
      problemSlug: 'sum',
      evaluationId: 5,
    });
  });

  test('resolveProblemListingMatch returns undefined when evaluation id is non-finite (lines 92-93)', () => {
    // A digit string too large for a JS Number converts to Infinity, failing the isFinite guard.
    const hugeEvalHref = `/detalii-evaluare/${'9'.repeat(400)}`;
    expect(resolveProblemListingMatch('/probleme/1/sum', hugeEvalHref)).toBeUndefined();
  });

  test('parseTotalMatches reads the bold summary count', () => {
    const $ = loadHtml('<div class="bold mb-3">42 soluții</div>');
    expect(parseTotalMatches($)).toBe(42);
  });

  test('extractRowScore returns undefined when the row has no cells', () => {
    const $ = loadHtml('<table><tr></tr></table>');
    const row = $('tr').toArray()[0]!;
    expect(extractRowScore($, row)).toBeUndefined();
  });

  test('extractRowScore reads the last numeric cell', () => {
    const $ = loadHtml('<table><tr><td>foo</td><td>87</td></tr></table>');
    const row = $('tr').toArray()[0]!;
    expect(extractRowScore($, row)).toBe(87);
  });

  test('extractCurrentOffset returns zero without a page url', () => {
    expect(extractCurrentOffset(undefined)).toBe(0);
    expect(extractCurrentOffset('https://www.pbinfo.ro/probleme?start=40')).toBe(40);
  });

  test('extractExplicitPaginationUrls skips anchors without an href and out-of-scope links', () => {
    const $ = loadHtml(`
      <div class="pagination">
        <a>no href</a>
        <a href="?start=20">next</a>
        <a href="?start=0">previous</a>
        <a href="https://elsewhere.example/?start=99">other origin</a>
      </div>
    `);

    const urls = extractExplicitPaginationUrls($, 'https://www.pbinfo.ro/probleme?start=10');

    expect(urls).toEqual(['https://www.pbinfo.ro/probleme?start=20']);
  });

  test('extractExplicitPaginationUrls returns nothing without a page url', () => {
    const $ = loadHtml('<div class="pagination"><a href="?start=20">next</a></div>');
    expect(extractExplicitPaginationUrls($, undefined)).toEqual([]);
  });

  test('parsePaginationMetadata prefers explicit pagination anchors', () => {
    const $ = loadHtml('<div class="pagination"><a href="?start=20">next</a></div>');

    const result = parsePaginationMetadata(
      $,
      '<html></html>',
      'https://www.pbinfo.ro/probleme?start=0',
      undefined,
    );

    expect(result).toEqual({
      pageSize: 1,
      currentOffset: 0,
      nextPageUrls: ['https://www.pbinfo.ro/probleme?start=20'],
    });
  });

  test('parsePaginationMetadata falls back to scripted Paginare totals', () => {
    const $ = loadHtml('<html></html>');

    const result = parsePaginationMetadata(
      $,
      'Paginare(50, 0, 20)',
      'https://www.pbinfo.ro/probleme',
      undefined,
    );

    expect(result).toEqual({
      pageSize: 20,
      currentOffset: 0,
      nextPageUrls: [
        'https://www.pbinfo.ro/probleme?start=20',
        'https://www.pbinfo.ro/probleme?start=40',
      ],
    });
  });

  test('parsePaginationMetadata returns undefined when no pagination signal exists', () => {
    const $ = loadHtml('<html></html>');

    expect(
      parsePaginationMetadata($, '<html></html>', 'https://www.pbinfo.ro/probleme', undefined),
    ).toBeUndefined();
  });

  test('parsePaginationMetadata returns an empty next-page list without a page url', () => {
    const $ = loadHtml('<html></html>');

    const result = parsePaginationMetadata($, 'Paginare(50, 0, 20)', undefined, 50);

    expect(result).toEqual({ pageSize: 20, currentOffset: 0, nextPageUrls: [] });
  });
});
