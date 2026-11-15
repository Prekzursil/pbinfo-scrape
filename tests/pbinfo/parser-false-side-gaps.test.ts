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

describe('parseCategoryPage parent recognition false sides', () => {
  test('skips a category anchor whose item list carries a foreign tag parameter', () => {
    const html = `
      <a href="/probleme/categorii/5/alpha">Alpha</a>
      <a href="/?pagina=itemi-evaluare-lista&disciplina=0&clasa=9&tag=99">Itemi</a>
    `;
    const parsed = parseCategoryPage(html, 9);
    expect(parsed.categories).toEqual([]);
  });

  test('continues past intermediate hrefs that are neither item lists nor categories', () => {
    const html = `
      <a href="/probleme/categorii/9/alpha">Alpha</a>
      <a href="/despre">About</a>
      <a href="/?pagina=itemi-evaluare-lista&disciplina=0&clasa=9&tag=9">Itemi</a>
    `;
    const parsed = parseCategoryPage(html, 9);
    expect(parsed.categories.map((category) => category.slug)).toEqual(['alpha']);
  });
});

describe('parseProblemStatementFragment empty-content false sides', () => {
  test('drops empty constraint list items', () => {
    const fragment = `<article id="enunt">
      <h1>Restricții și precizări</h1>
      <ul>
        <li>   </li>
        <li>10 ≤ n ≤ 20</li>
      </ul>
    </article>`;
    const parsed = parseProblemStatementFragment(fragment);
    expect(parsed.constraints).toEqual(['10 ≤ n ≤ 20']);
  });

  test('drops a leading example pre block that arrives before any cue', () => {
    const fragment = `<article id="enunt">
      <h1>Exemplu:</h1>
      <pre>orphan</pre>
    </article>`;
    const parsed = parseProblemStatementFragment(fragment);
    expect(parsed.examples).toEqual([]);
  });

  test('ignores non-pre content while an input cue is pending', () => {
    const fragment = `<article id="enunt">
      <h1>Exemplu:</h1>
      <p><strong>Intrare</strong></p>
      <b>sidebar note</b>
      <pre>42</pre>
      <p><strong>Ieșire</strong></p>
      <pre>43</pre>
    </article>`;
    const parsed = parseProblemStatementFragment(fragment);
    expect(parsed.examples).toEqual([{ input: '42', output: '43', explanation: undefined }]);
  });
});

describe('parseProblemPage summary and tag false sides', () => {
  test('ignores summary rows and tag anchors with empty values', () => {
    const html = `<html><body>
      <h1><a href="/probleme/400/blank">Blank</a></h1>
      <div id="rezumat"><table>
        <tr><th>Postată de</th><td> </td></tr>
        <tr><th>Clasa</th><td>9</td></tr>
      </table></div>
      <a href="/probleme/eticheta/graphs">graphs</a>
      <a href="/probleme/eticheta/empty-tag"></a>
    </body></html>`;
    const record = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/400/blank');
    expect(record.tags).toEqual(['graphs']);
  });
});

describe('parseOfficialSolutionFragment tab label false side', () => {
  test('skips tab anchors whose label is blank', () => {
    const fragment = `
      <a href="#empty"></a>
      <a href="#solutii">Soluții</a>
      <div id="solutii"><pre>int main() { return 0; }</pre></div>
    `;
    const parsed = parseOfficialSolutionFragment(fragment);
    expect(parsed.solutions['Soluții']).toBe('int main() { return 0; }');
    // The blank-label #empty anchor contributed no key of its own.
    expect(Object.keys(parsed.solutions)).toEqual(['Soluții']);
  });
});

describe('parseEvaluationPage summary false side', () => {
  test('ignores summary pairs whose value cell is blank', () => {
    const html = `<html><body>
      <a href="/probleme/400/blank">Blank</a>
      <div id="rezumat"><table>
        <tr><th>Problemă</th><td> </td></tr>
        <tr><th>Punctaj</th><td>100</td></tr>
      </table></div>
    </body></html>`;
    const parsed = parseEvaluationPage(html, 501);
    // The blank "Problemă" value is dropped, so the name falls back to the
    // problem link text; the filled "Punctaj" row still reaches the record.
    expect(parsed.problemName).toBe('Blank');
    expect(parsed.score).toBe(100);
  });
});

describe('parseUserSolutionsListPage pagination ordering', () => {
  test('orders multiple same-path pagination urls by their start offset', () => {
    const html = `<div class="pagination">
      <a href="?start=40">4</a>
      <a href="?start=20">2</a>
      <a href="?start=30">3</a>
    </div>`;
    const result = parseUserSolutionsListPage(html, 'https://www.pbinfo.ro/solutii?start=10');
    expect(result.nextPageUrls).toEqual([
      'https://www.pbinfo.ro/solutii?start=20',
      'https://www.pbinfo.ro/solutii?start=30',
      'https://www.pbinfo.ro/solutii?start=40',
    ]);
  });
});

describe('parseProblemEndpointFragment visible-test cue false sides', () => {
  test('keeps walking past cue-less paragraphs and mode-less pre blocks', () => {
    const fragment = `
      <h2>Teste de evaluare</h2>
      <div class="pb-tests">
        <h3>Testul 1</h3>
        <p>Notă introductivă</p>
        <div>plain note between cues</div>
        <pre>fără mod</pre>
      </div>
    `;
    const parsed = parseProblemEndpointFragment(fragment);
    expect(parsed.visibleTests).toEqual([
      { title: 'Testul 1', input: '', output: '' },
    ]);
  });
});
