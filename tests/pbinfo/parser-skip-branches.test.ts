import { describe, expect, test } from 'vitest';

import { parseCategoryPage } from '../../src/pbinfo/parsers/category.js';
import { parseEvaluationPage } from '../../src/pbinfo/parsers/evaluation.js';
import {
  parseOfficialSolutionFragment,
  parseProblemEndpointFragment,
  parseProblemPage,
  parseProblemStatementFragment,
} from '../../src/pbinfo/parsers/problem.js';
import { parseUserSolutionsListPage } from '../../src/pbinfo/parsers/user-solutions.js';

// The paths below are the "nothing to record" side of each parser's guards:
// blank list items, unlabelled tabs, cues that match no mode, empty cells.

describe('problem statement and fragments', () => {
  test('a blank constraint item is not recorded', () => {
    const parsed = parseProblemStatementFragment(
      '<div id="enunt"><h1>Restricții</h1><ul><li>   </li><li>1 ≤ n ≤ 100</li></ul></div>',
    );
    expect(parsed.constraints).toEqual(['1 ≤ n ≤ 100']);
  });

  test('example blocks ignore a <pre> before any cue and prose outside the explanation', () => {
    const parsed = parseProblemStatementFragment(`<div id="enunt"><h1>Exemplu</h1>
      <pre>orphan block</pre>
      <p>Intrare</p>
      <p>datele sunt pe o linie</p>
      <pre>1 2</pre>
      <p>Ieșire</p>
      <pre>3</pre>
    </div>`);
    expect(parsed.examples).toEqual([{ input: '1 2', output: '3' }]);
  });

  test('an unlabelled tab does not name its solution', () => {
    const parsed = parseOfficialSolutionFragment(
      '<a href="#tab-1"></a><div id="tab-1"><pre>int main() {}</pre></div>',
    );
    expect(parsed.access).toBe('visible');
    expect(parsed.solutions).toEqual({ unknown: 'int main() {}' });
  });

  test('visible tests skip unknown cues, non-block siblings and a <pre> before any cue', () => {
    const parsed = parseProblemEndpointFragment(`
      <h3>Test 1</h3>
      <pre>orphan</pre>
      <p>Notă</p>
      <div>separator</div>
      <p>Intrare</p><pre>1 2</pre>
      <p>Ieșire</p><pre>3</pre>`);
    expect(parsed.access).toBe('visible');
    expect(parsed.visibleTests).toEqual([{ title: 'Test 1', input: '1 2', output: '3' }]);
  });
});

describe('problem page summary and tags', () => {
  test('an empty summary cell keeps the table value and an empty tag link is dropped', () => {
    const html = `<html><body>
      <h1><a href="/probleme/123/sum">Sum</a></h1>
      <table>
        <tr><th>Clasa</th></tr>
        <tr><td>9</td></tr>
      </table>
      <div id="rezumat"><table>
        <tr><th>Clasa</th><td>  </td></tr>
        <tr><th></th><td>orphan value</td></tr>
      </table></div>
      <a href="/probleme/eticheta/grafuri">grafuri</a>
      <a href="/probleme/eticheta/goala"> </a>
    </body></html>`;
    const record = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/123/sum');
    expect(record.grade).toBe(9);
    expect(record.tags).toEqual(['grafuri']);
  });
});

describe('category page', () => {
  test('skips unrelated anchors before the item list and items listed under another tag', () => {
    const parsed = parseCategoryPage(
      `<a href="/probleme/categorii/5/grafuri">Grafuri</a>
       <a href="/altceva">altceva</a>
       <a href="/?pagina=itemi-evaluare-lista&tag=5">lista</a>
       <a href="/probleme/categorii/6/arbori">Arbori</a>
       <a href="/?pagina=itemi-evaluare-lista&tag=99">lista</a>`,
      9,
    );
    expect(parsed).toEqual({
      grade: 9,
      categories: [
        {
          id: 5,
          name: 'Grafuri',
          slug: 'grafuri',
          href: '/probleme/categorii/5/grafuri',
          itemListHref: '/?pagina=itemi-evaluare-lista&tag=5',
          subcategories: [],
        },
      ],
    });
  });
});

describe('evaluation summary', () => {
  test('an empty header or value cell is not recorded', () => {
    const parsed = parseEvaluationPage(
      `<div id="rezumat">
        <a href="/probleme/10/demo">Demo</a>
        <table class="table">
          <tr><th>Punctaj</th><td> </td></tr>
          <tr><th> </th><td>40</td></tr>
        </table>
      </div>`,
      7,
    );
    expect(parsed.score).toBe(0);
  });
});

describe('user solutions pagination', () => {
  test('explicit next-page links are returned in offset order', () => {
    const html = `<div class="pagination">
      <a href="?start=40">3</a>
      <a href="?start=20">2</a>
    </div>`;
    const result = parseUserSolutionsListPage(html, 'https://www.pbinfo.ro/solutii?start=0');
    expect(result.nextPageUrls).toEqual([
      'https://www.pbinfo.ro/solutii?start=20',
      'https://www.pbinfo.ro/solutii?start=40',
    ]);
  });
});
