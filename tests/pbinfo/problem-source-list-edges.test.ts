import { describe, expect, test } from 'vitest';

import { parseProblemSourceListPage } from '../../src/pbinfo/parsers/problem-source-list.js';

const HUGE = '9'.repeat(320);

describe('parseProblemSourceListPage rows and author handle', () => {
  test('parses table rows with totals, throttling, and the preferred author link', () => {
    const html = `<div>
      <div class="bold mb-3">42 rezultate</div>
      <span title="Postată de"><a href="/profil/teacher">Teacher</a></span>
      <table>
        <tr><td><a href="/profil/alice">Alice</a></td><td><a href="/probleme/1/sum">Sum</a></td><td><a href="/detalii-evaluare/100">v</a></td><td>100</td></tr>
        <tr><td><a href="/profil/alice">Alice</a></td><td><a href="/probleme/1/sum">Sum</a></td><td><a href="/detalii-evaluare/100">v</a></td><td>90</td></tr>
        <tr><td><a href="/probleme/2/x">X</a></td><td><a href="/detalii-evaluare/${HUGE}">v</a></td></tr>
        <tr><td><a href="/probleme/6/a">A</a></td><td><a href="/detalii-evaluare/500">v</a></td><td>80</td></tr>
        <tr><th><a href="/probleme/7/b">B</a></th><th><a href="/detalii-evaluare/600">v</a></th></tr>
        <tr><td><a href="/probleme/8/c">C</a></td><td><a href="/detalii-evaluare/700">v</a></td><td>xyz</td></tr>
        <tr><td>nothing</td></tr>
      </table>
    </div>`;
    const result = parseProblemSourceListPage(html);
    expect(result.authorHandle).toBe('teacher');
    expect(result.totalMatches).toBe(42);
    expect(result.entries.map((entry) => entry.evaluationId)).toEqual([100, 500, 600, 700]);
    expect(result.entries.find((entry) => entry.evaluationId === 500)?.user).toBeUndefined();
    expect(result.entries.find((entry) => entry.evaluationId === 600)?.score).toBeUndefined();
    expect(result.entries.find((entry) => entry.evaluationId === 700)?.score).toBeUndefined();
  });

  test('detects throttling and reads the author handle from a summary row', () => {
    const html = `<div>
      Resursă indisponibilă temporar.
      <table>
        <tr></tr>
        <tr><th>Altceva</th><td>x</td></tr>
        <tr><th>Postată de</th><td><a href="/profil/summaryauthor">S</a></td></tr>
      </table>
    </div>`;
    const result = parseProblemSourceListPage(html);
    expect(result.throttled).toBe(true);
    expect(result.authorHandle).toBe('summaryauthor');
  });

  test('returns no author handle when none is present', () => {
    const result = parseProblemSourceListPage('<div><p>nothing here</p></div>');
    expect(result.authorHandle).toBeUndefined();
    expect(result.entries).toEqual([]);
  });

  test('returns undefined when the preferred author link does not match a profile path', () => {
    const html = `<div>
      <span title="Postată de"><a href="/profil/multi/segment">bad</a></span>
      <table><tr><th>Postată de</th><td><a href="/profil/ignored">i</a></td></tr></table>
    </div>`;
    const result = parseProblemSourceListPage(html);
    expect(result.authorHandle).toBeUndefined();
  });
});

describe('parseProblemSourceListPage anchor triplets', () => {
  test('parses problem/evaluation anchor pairs and triplets with a profile link', () => {
    const html = `<div>
      <a href="/probleme/1/sum">Sum</a><a href="/detalii-evaluare/100">v</a>
      <a href="/probleme/2/diff">Diff</a><a href="/profil/bob">Bob (bobby)</a><a href="/detalii-evaluare/200">v</a>
      <a href="/probleme/3/none">None</a><a href="/somewhere-else">x</a>
      <a href="/probleme/4/dup">Dup</a><a href="/detalii-evaluare/100">v</a>
      <a href="/probleme/5/big">Big</a><a href="/detalii-evaluare/${HUGE}">v</a>
    </div>`;
    const result = parseProblemSourceListPage(html);
    expect(result.entries.map((entry) => entry.evaluationId)).toEqual([100, 200]);
    expect(result.entries.find((entry) => entry.evaluationId === 200)?.user).toBe('bobby');
  });
});

describe('parseProblemSourceListPage pagination', () => {
  test('derives explicit pagination urls and filters off-path/stale/overflow links', () => {
    const html = `<div class="pagination">
      <a href="?start=20">2</a>
      <a href="https://other.example/x?start=40">other</a>
      <a href="/alt?start=60">alt</a>
      <a href="?start=0">stale</a>
      <a href="?start=${HUGE}">overflow</a>
    </div>`;
    const result = parseProblemSourceListPage(html, 'https://www.pbinfo.ro/solutii?start=10');
    expect(result.nextPageUrls).toEqual(['https://www.pbinfo.ro/solutii?start=20']);
    expect(result.currentOffset).toBe(10);
  });

  test('derives pagination from a Paginare() call and skips invalid sizes/totals', () => {
    const ok = parseProblemSourceListPage('<div>Paginare(50, 0, 20)</div>', 'https://www.pbinfo.ro/solutii');
    expect(ok.nextPageUrls).toEqual([
      'https://www.pbinfo.ro/solutii?start=20',
      'https://www.pbinfo.ro/solutii?start=40',
    ]);
    expect(parseProblemSourceListPage('<div>Paginare(10, 0, 0)</div>').pageSize).toBeUndefined();
    expect(parseProblemSourceListPage(`<div>Paginare(${HUGE}, 0, 10)</div>`).pageSize).toBeUndefined();
    expect(parseProblemSourceListPage(`<div>Paginare(10, ${HUGE}, 10)</div>`).pageSize).toBeUndefined();
    expect(parseProblemSourceListPage(`<div>Paginare(10, 0, ${HUGE})</div>`).pageSize).toBeUndefined();
  });

  test('treats a negative start offset as zero', () => {
    const html = '<div class="pagination"><a href="?start=20">2</a></div>';
    const result = parseProblemSourceListPage(html, 'https://www.pbinfo.ro/solutii?start=-5');
    expect(result.currentOffset).toBe(0);
  });
});
