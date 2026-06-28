import { describe, expect, test } from 'vitest';

import { parseUserSolutionsListPage } from '../../src/pbinfo/parsers/user-solutions.js';

const HUGE = '9'.repeat(320); // Number(HUGE) === Infinity

describe('parseUserSolutionsListPage rows', () => {
  test('parses table rows and skips duplicates, overflows, and malformed rows', () => {
    const html = `<table>
      <tr><td><a href="/profil/alice">Alice</a></td><td><a href="/probleme/1/sum">Sum</a></td><td><a href="/detalii-evaluare/100">v</a></td><td>100</td></tr>
      <tr><td><a href="/profil/alice">Alice</a></td><td><a href="/probleme/1/sum">Sum</a></td><td><a href="/detalii-evaluare/100">v</a></td><td>90</td></tr>
      <tr><td><a href="/profil/bob">Display (bobby)</a></td><td><a href="/probleme/2/x">X</a></td><td><a href="/detalii-evaluare/200">v</a></td><td>50</td></tr>
      <tr><th><a href="/profil/carol">C</a></th><th><a href="/probleme/3/y">Y</a></th><th><a href="/detalii-evaluare/300">v</a></th></tr>
      <tr><td><a href="/profil/dan">D</a></td><td><a href="/probleme/4/z">Z</a></td><td><a href="/detalii-evaluare/${HUGE}">v</a></td><td>10</td></tr>
      <tr><td><a href="/profil/eve">E</a></td><td><a href="/probleme/5/w">W</a></td><td><a href="/detalii-evaluare/400">v</a></td><td>n/a</td></tr>
      <tr><td>no anchors here</td></tr>
    </table>`;
    const result = parseUserSolutionsListPage(html);
    expect(result.entries.map((entry) => entry.evaluationId).sort((a, b) => a - b)).toEqual([
      100, 200, 300, 400,
    ]);
    expect(result.entries.find((entry) => entry.evaluationId === 400)?.score).toBeUndefined();
    expect(result.entries.find((entry) => entry.evaluationId === 200)?.user).toBe('bobby');
    expect(result.entries.find((entry) => entry.evaluationId === 300)?.score).toBeUndefined();
  });

  test('parses anchor triplets when no table rows match', () => {
    const html = `<div>
      <a href="/profil/alice">Alice</a><a href="/probleme/1/sum">Sum</a><a href="/detalii-evaluare/100">v</a>
      <a href="/profil/bob">Bob</a><a href="/not-a-problem">x</a><a href="/detalii-evaluare/101">v</a>
      <a href="/profil/carol">Carol</a><a href="/probleme/2/y">Y</a><a href="/detalii-evaluare/100">dup</a>
      <a href="/profil/dan">Dan</a><a href="/probleme/3/z">Z</a><a href="/detalii-evaluare/${HUGE}">v</a>
      <a href="/not-a-profile">skip</a>
    </div>`;
    const result = parseUserSolutionsListPage(html);
    expect(result.entries.map((entry) => entry.evaluationId)).toEqual([100]);
  });
});

describe('parseUserSolutionsListPage pagination', () => {
  test('derives explicit pagination urls and ignores off-path or stale links', () => {
    const html = `<div class="pagination">
      <a href="?start=20">2</a>
      <a href="https://other.example/probleme?start=40">other</a>
      <a href="/alt-path?start=60">alt</a>
      <a href="?start=0">stale</a>
      <a href="?start=${HUGE}">overflow</a>
    </div>`;
    const result = parseUserSolutionsListPage(html, 'https://www.pbinfo.ro/solutii?start=10');
    expect(result.nextPageUrls).toEqual(['https://www.pbinfo.ro/solutii?start=20']);
    expect(result.currentOffset).toBe(10);
  });

  test('derives pagination from a Paginare() call when no links exist', () => {
    const html = '<div>Paginare( 50, 0, 20 )</div>';
    const result = parseUserSolutionsListPage(html, 'https://www.pbinfo.ro/solutii');
    expect(result.pageSize).toBe(20);
    expect(result.nextPageUrls).toEqual([
      'https://www.pbinfo.ro/solutii?start=20',
      'https://www.pbinfo.ro/solutii?start=40',
    ]);
  });

  test('returns no pagination for an invalid Paginare() page size', () => {
    const result = parseUserSolutionsListPage('<div>Paginare(10, 0, 0)</div>');
    expect(result.pageSize).toBeUndefined();
    expect(result.nextPageUrls).toEqual([]);
  });

  test('returns no pagination for an overflowing Paginare() total', () => {
    const result = parseUserSolutionsListPage(`<div>Paginare(${HUGE}, 0, 10)</div>`);
    expect(result.pageSize).toBeUndefined();
  });

  test('treats a negative start offset as zero', () => {
    const html = '<div class="pagination"><a href="?start=20">2</a></div>';
    const result = parseUserSolutionsListPage(html, 'https://www.pbinfo.ro/solutii?start=-5');
    expect(result.currentOffset).toBe(0);
  });
});
